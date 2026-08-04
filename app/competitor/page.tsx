"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/lib/auth";

// Klikalne przykłady zestawień firm.
const EXAMPLES: [string, string, string][] = [
  ["Shopify", "WooCommerce", "PrestaShop"],
  ["Notion", "Obsidian", "Evernote"],
  ["Vercel", "Netlify", "Railway"],
  ["ChatGPT", "Claude", "Gemini"],
];

type Part = {
  type: string;
  text?: string;
  url?: string;
  title?: string;
  input?: { url?: string; query?: string };
};

// Zapisana analiza z bazy.
type SavedAnalysis = {
  id: string;
  title: string;
  companies: string | null;
  context: string | null;
  content: string;
  created_at: string;
};

function messageText(parts: Part[]) {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

// Zbierz unikalne źródła (source-url) zwrócone przez grounding.
function messageSources(parts: Part[]) {
  const seen = new Set<string>();
  const out: { url: string; title: string }[] = [];
  for (const p of parts) {
    if (p.type === "source-url" && p.url && !seen.has(p.url)) {
      seen.add(p.url);
      let label = p.title?.trim() || "";
      if (!label) {
        try {
          label = new URL(p.url).hostname.replace(/^www\./, "");
        } catch {
          label = p.url;
        }
      }
      out.push({ url: p.url, title: label });
    }
  }
  return out;
}

// Ślad pracy agenta: co czyta i czego szuka w Wikipedii.
function activity(parts: Part[]) {
  const out: string[] = [];
  for (const p of parts) {
    if (p.type === "tool-readWebPage" && p.input?.url) {
      out.push(`📄 Czytam: ${p.input.url}`);
    }
    if (p.type === "tool-searchWikipedia" && p.input?.query) {
      out.push(`📚 Wikipedia: ${p.input.query}`);
    }
  }
  return out;
}

// ── Eksport do Word ─────────────────────────────────────────────────────────
// Zamieniamy markdown na HTML zgodny z Wordem i pobieramy jako .doc. Word otwiera
// taki plik natywnie (z tabelami, nagłówkami, linkami), a my nie dokładamy
// żadnej biblioteki. Obsługujemy format, który zwraca agent: nagłówki #..###,
// tabele GFM (|...|), pogrubienia **...**, listy - oraz linki [tekst](url).

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Formatowanie w linii: **pogrubienie** i [tekst](url).
function inline(s: string) {
  let out = escapeHtml(s);
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text, url) => `<a href="${url}">${text}</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  // Goły URL (np. w sekcji Źródła) — zamień na klikalny link.
  out = out.replace(
    /(^|[\s(])(https?:\/\/[^\s)<]+)/g,
    (_m, pre, url) => `${pre}<a href="${url}">${url}</a>`,
  );
  return out;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Tabela GFM: wiersz | ... | + linia separatora | --- |
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])
    ) {
      closeList();
      const header = splitRow(line);
      i += 2; // pomiń nagłówek + separator
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      html.push(
        '<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%">',
      );
      html.push(
        "<tr>" +
          header
            .map(
              (c) =>
                `<th style="background:var(--text);text-align:left">${inline(c)}</th>`,
            )
            .join("") +
          "</tr>",
      );
      for (const r of rows) {
        html.push(
          "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>",
        );
      }
      html.push("</table>");
      continue;
    }

    // Nagłówki
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Lista punktowana
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inline(li[1])}</li>`);
      i++;
      continue;
    }

    // Pusta linia
    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    // Zwykły akapit
    closeList();
    html.push(`<p>${inline(line)}</p>`);
    i++;
  }
  closeList();
  return html.join("\n");
}

function downloadWord(markdown: string, title: string) {
  const body = markdownToHtml(markdown);
  const doc = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #111; }
  h1 { font-size: 20pt; } h2 { font-size: 15pt; } h3 { font-size: 13pt; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 6px; vertical-align: top; }
  a { color: #1155cc; }
</style>
</head>
<body>${body}</body>
</html>`;
  const blob = new Blob(["﻿", doc], {
    type: "application/msword;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (title || "analiza-konkurencji")
    .replace(/[^\p{L}\p{N} _-]+/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  a.href = url;
  a.download = `${safe || "analiza-konkurencji"}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CompetitorPage() {
  const { user } = useAuth();
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/competitor" }),
    [],
  );
  const { messages, sendMessage, status, setMessages } = useChat({ transport });

  const [c1, setC1] = useState("");
  const [c2, setC2] = useState("");
  const [c3, setC3] = useState("");
  const [context, setContext] = useState("");
  const [companies, setCompanies] = useState(""); // firmy aktualnej analizy
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Zapis do bazy.
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Panel "Zapisane analizy".
  const [saved, setSaved] = useState<SavedAnalysis[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  // Analiza otwarta w oknie szybkiego podglądu (modal). null = zamknięte.
  const [preview, setPreview] = useState<SavedAnalysis | null>(null);

  const isLoading = status === "submitted" || status === "streaming";

  // Analiza ze strumienia = ostatnia odpowiedź agenta.
  const display = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last) return null;
    const parts = last.parts as Part[];
    return {
      text: messageText(parts),
      sources: messageSources(parts),
      acts: activity(parts),
    };
  }, [messages]);

  // Świeżą analizę można zapisać tylko raz i tylko gdy generowanie się skończyło.
  const canSave = !!display?.text && !isLoading && !!user && savedId === null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Zamknij podgląd klawiszem Esc.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  // Wczytaj listę zapisanych analiz zalogowanego użytkownika.
  const loadSaved = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("competitor_analyses")
      .select("id, title, companies, context, content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Nie udało się wczytać zapisanych analiz.", error);
      return;
    }
    setSaved((data ?? []) as SavedAnalysis[]);
  }, [user]);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  function compare(firms: [string, string, string], ctx?: string) {
    const clean = firms.map((f) => f.trim()).filter(Boolean);
    if (clean.length < 2 || isLoading) return;

    setMessages([]); // jedna analiza naraz — czyścimy poprzednią
    setSavedId(null);
    setSaveError(null);
    setCopied(false);
    setCompanies(clean.join(", "));

    const ctxLine = (ctx ?? context).trim()
      ? `\n\nKontekst użytkownika: ${(ctx ?? context).trim()}`
      : "";
    // userId leci do route'a, żeby budżet tokenów (L10 W3) wiedział, czyj to koszt.
    sendMessage(
      { text: `Porównaj następujące firmy: ${clean.join(", ")}.${ctxLine}` },
      { body: { userId: user?.id } },
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    compare([c1, c2, c3]);
  }

  function useExample(firms: [string, string, string]) {
    setC1(firms[0]);
    setC2(firms[1]);
    setC3(firms[2]);
    compare(firms);
  }

  async function copyAnalysis() {
    if (!display?.text) return;
    try {
      await navigator.clipboard.writeText(display.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function saveAnalysis() {
    if (!display?.text || !user || saving) return;
    setSaving(true);
    setSaveError(null);
    const title = (companies || "Analiza konkurencji").slice(0, 200);
    const { data, error } = await supabase
      .from("competitor_analyses")
      .insert({
        user_id: user.id,
        title,
        companies: companies || null,
        context: context.trim() || null,
        content: display.text,
      })
      .select("id, title, companies, context, content, created_at")
      .single();
    setSaving(false);
    if (error || !data) {
      console.error("Nie udało się zapisać analizy.", error);
      // Pokaż PRAWDZIWĄ przyczynę z bazy — najczęściej RLS (42501: brak polityki
      // zezwalającej na insert) albo brak tabeli (42P01). Bez tego diagnoza
      // jest zgadywaniem.
      const detail =
        error?.code === "42501"
          ? "brak polityki RLS na tabeli 'competitor_analyses' — uruchom sekcję RLS z supabase/L08_W3_competitor.sql."
          : error?.code === "42P01"
            ? "tabela 'competitor_analyses' nie istnieje — uruchom migrację supabase/L08_W3_competitor.sql."
            : (error?.message ?? "nieznany błąd.");
      setSaveError(`Nie udało się zapisać: ${detail}`);
      return;
    }
    setSavedId(data.id);
    setSaved((prev) => [data as SavedAnalysis, ...prev]);
  }

  async function deleteSaved(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const { error } = await supabase
      .from("competitor_analyses")
      .delete()
      .eq("id", id)
      .eq("user_id", user!.id); // dodatkowy filtr — nie kasuj cudzego
    if (error) {
      console.error("Nie udało się usunąć analizy.", error);
      return;
    }
    setSaved((prev) => prev.filter((r) => r.id !== id));
    if (preview?.id === id) setPreview(null);
  }

  const canCompare =
    [c1, c2, c3].map((f) => f.trim()).filter(Boolean).length >= 2 && !isLoading;

  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 150,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    color: "var(--text)",
    padding: "12px 14px",
    fontSize: 15,
    outline: "none",
  };

  return (
    <div
      style={{
        maxWidth: 900,
        margin: "0 auto",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "0 16px",
      }}
    >
      <header style={{ padding: "24px 0 12px", textAlign: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>🏢 Analiza konkurencji</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Podaj firmy — agent porówna je za Ciebie
        </div>
      </header>

      {/* Formularz firm */}
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8 }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={c1}
            onChange={(e) => setC1(e.target.value)}
            placeholder="Np. Shopify"
            style={inputStyle}
          />
          <input
            value={c2}
            onChange={(e) => setC2(e.target.value)}
            placeholder="Np. WooCommerce"
            style={inputStyle}
          />
          <input
            value={c3}
            onChange={(e) => setC3(e.target.value)}
            placeholder="Np. PrestaShop"
            style={inputStyle}
          />
        </div>

        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Kontekst (opcjonalnie) — np. Szukam platformy e-commerce dla małego sklepu"
          rows={2}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            color: "var(--text)",
            padding: "10px 14px",
            fontSize: 14,
            outline: "none",
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />

        <button
          type="submit"
          disabled={!canCompare}
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-2)",
            borderRadius: 10,
            color: "var(--text)",
            padding: "12px 20px",
            fontSize: 15,
            alignSelf: "flex-start",
            cursor: !canCompare ? "not-allowed" : "pointer",
            opacity: !canCompare ? 0.5 : 1,
          }}
        >
          🔍 Porównaj
        </button>
      </form>

      {/* Pasek "Zapisane analizy" */}
      <div style={{ paddingBottom: 12 }}>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text)",
            padding: "5px 12px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          📁 Zapisane analizy {saved.length > 0 ? `(${saved.length})` : ""}{" "}
          {panelOpen ? "▲" : "▼"}
        </button>

        {panelOpen && (
          <div
            style={{
              marginTop: 8,
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {!user ? (
              <div style={{ padding: "12px 14px", color: "var(--muted)", fontSize: 13 }}>
                Zaloguj się, aby zapisywać i przeglądać analizy.
              </div>
            ) : saved.length === 0 ? (
              <div style={{ padding: "12px 14px", color: "var(--muted)", fontSize: 13 }}>
                Brak zapisanych analiz. Wygeneruj analizę i kliknij „💾 Zapisz w
                bazie".
              </div>
            ) : (
              saved.map((r) => (
                <div
                  key={r.id}
                  onClick={() => setPreview(r)}
                  title="Kliknij, aby otworzyć podgląd"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--border-soft)",
                    cursor: "pointer",
                    background: preview?.id === r.id ? "var(--surface-3)" : "transparent",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.title}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted-dim)" }}>
                      {new Date(r.created_at).toLocaleString("pl-PL")}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadWord(r.content, r.title);
                    }}
                    title="Eksport do Word"
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border-2)",
                      borderRadius: 6,
                      color: "var(--accent-link)",
                      padding: "2px 8px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    📝
                  </button>
                  <button
                    onClick={(e) => deleteSaved(r.id, e)}
                    title="Usuń"
                    style={{
                      background: "transparent",
                      border: "1px solid var(--danger-border)",
                      borderRadius: 6,
                      color: "var(--danger-text)",
                      padding: "2px 8px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    🗑
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflowY: "auto",
          paddingBottom: 16,
        }}
      >
        {/* Ekran startowy z przykładami */}
        {messages.length === 0 && (
          <div style={{ marginTop: 12 }}>
            <p style={{ color: "var(--muted)", textAlign: "center", marginBottom: 12 }}>
              Wybierz przykład lub wpisz własne firmy:
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                justifyContent: "center",
              }}
            >
              {EXAMPLES.map((firms) => (
                <button
                  key={firms.join("-")}
                  onClick={() => useExample(firms)}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    color: "var(--text)",
                    padding: "8px 12px",
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {firms.join(" vs ")}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Ślad pracy agenta (co czyta / czego szuka) */}
        {display?.acts && display.acts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {display.acts.map((a, i) => (
              <span
                key={i}
                style={{
                  fontSize: 11,
                  color: "var(--muted-strong)",
                  background: "var(--surface)",
                  border: "1px solid #3b82f6",
                  borderRadius: 999,
                  padding: "2px 10px",
                  alignSelf: "flex-start",
                }}
              >
                {a}
              </span>
            ))}
          </div>
        )}

        {/* Gotowa analiza */}
        {display?.text && (
          <>
            {/* Pasek akcji */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                onClick={copyAnalysis}
                style={{
                  background: copied ? "var(--ok-bg)" : "var(--surface)",
                  border: `1px solid ${copied ? "var(--ok-border)" : "var(--border)"}`,
                  borderRadius: 8,
                  color: copied ? "var(--ok-text)" : "var(--text)",
                  padding: "6px 14px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {copied ? "✅ Skopiowano!" : "📋 Kopiuj analizę"}
              </button>

              {/* Zapis do bazy */}
              <button
                onClick={saveAnalysis}
                disabled={!canSave || saving}
                title={!user ? "Zaloguj się, aby zapisać" : undefined}
                style={{
                  background: savedId ? "var(--ok-bg)" : "var(--surface)",
                  border: `1px solid ${savedId ? "var(--ok-border)" : "var(--border)"}`,
                  borderRadius: 8,
                  color: savedId ? "var(--ok-text)" : "var(--text)",
                  padding: "6px 14px",
                  fontSize: 13,
                  cursor: !canSave || saving ? "not-allowed" : "pointer",
                  opacity: !canSave && !savedId ? 0.5 : 1,
                }}
              >
                {savedId
                  ? "✅ Zapisano w bazie"
                  : saving
                    ? "⏳ Zapisuję..."
                    : "💾 Zapisz w bazie"}
              </button>

              {/* Eksport do Word */}
              <button
                onClick={() =>
                  downloadWord(display.text, companies || "Analiza konkurencji")
                }
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text)",
                  padding: "6px 14px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                📝 Eksport do Word
              </button>
            </div>

            {saveError && (
              <div
                style={{
                  background: "var(--danger-bg)",
                  border: "1px solid var(--danger-border)",
                  borderRadius: 10,
                  color: "var(--danger-text)",
                  padding: "8px 12px",
                  fontSize: 13,
                }}
              >
                ⚠️ {saveError}
              </div>
            )}

            <article
              style={{
                background: "var(--surface-3)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "20px 24px",
                lineHeight: 1.6,
                overflowWrap: "anywhere",
              }}
            >
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {display.text}
                </ReactMarkdown>
              </div>
            </article>

            {display.sources.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 12,
                  color: "var(--muted)",
                  paddingLeft: 2,
                }}
              >
                <span>🔗 Źródła (grounding):</span>
                {display.sources.map((s, i) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#3b82f6", textDecoration: "none" }}
                  >
                    {i + 1}. {s.title}
                  </a>
                ))}
              </div>
            )}
          </>
        )}

        {/* Wskaźnik pracy */}
        {isLoading && !display?.text && (
          <div
            style={{
              alignSelf: "flex-start",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "10px 14px",
              color: "var(--muted)",
            }}
          >
            🔍 Agent zbiera informacje o firmach i porównuje...
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* ── Okno szybkiego podglądu zapisanej analizy ───────────────────── */}
      {preview && (
        <div
          onClick={() => setPreview(null)} // klik w tło zamyka
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 200,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()} // klik w okno nie zamyka
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              width: "100%",
              maxWidth: 820,
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            }}
          >
            {/* Nagłówek okna (przyklejony) */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 18px",
                borderBottom: "1px solid var(--border-soft)",
                flexShrink: 0,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={preview.title}
                >
                  🏢 {preview.title}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted-dim)" }}>
                  {new Date(preview.created_at).toLocaleString("pl-PL")}
                </div>
              </div>
              <button
                onClick={() => downloadWord(preview.content, preview.title)}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text)",
                  padding: "5px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                📝 Word
              </button>
              <button
                onClick={() => setPreview(null)}
                aria-label="Zamknij"
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text)",
                  padding: "5px 10px",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            {/* Treść — przewijana w dół */}
            <div
              style={{
                overflowY: "auto",
                padding: "18px 24px",
                lineHeight: 1.6,
                overflowWrap: "anywhere",
              }}
            >
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {preview.content}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
