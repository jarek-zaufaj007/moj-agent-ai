"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/lib/auth";

// Klikalne przykłady tematów raportu.
const EXAMPLES = [
  "Rynek AI w Polsce — trendy, firmy, prognozy na 2026",
  "Porównanie platform e-commerce: Shopify vs WooCommerce vs PrestaShop",
  "Wpływ pracy zdalnej na produktywność — badania i statystyki",
  "Rynek nieruchomości w Krakowie — ceny, trendy, prognozy",
];

type Part = {
  type: string;
  text?: string;
  url?: string;
  title?: string;
  input?: { url?: string; query?: string };
};

// Zapisany raport z bazy.
type SavedReport = {
  id: string;
  title: string;
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

export default function ReportPage() {
  const { user } = useAuth();
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/report" }),
    [],
  );
  const { messages, sendMessage, status, setMessages } = useChat({ transport });
  const [input, setInput] = useState("");
  const [topic, setTopic] = useState(""); // temat aktualnie generowanego raportu
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Zapis do bazy.
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null); // id po zapisie
  const [saveError, setSaveError] = useState<string | null>(null);

  // Panel "Zapisane raporty".
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ title: string; text: string } | null>(
    null,
  ); // raport otwarty z listy (zamiast świeżo wygenerowanego)

  const isLoading = status === "submitted" || status === "streaming";

  // Raport ze strumienia (świeżo generowany) = ostatnia odpowiedź agenta.
  const live = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last) return null;
    const parts = last.parts as Part[];
    return {
      text: messageText(parts),
      sources: messageSources(parts),
      acts: activity(parts),
    };
  }, [messages]);

  // Co pokazujemy: otwarty z listy raport ma pierwszeństwo nad świeżym.
  const display = loaded
    ? { text: loaded.text, sources: [] as { url: string; title: string }[], acts: [] as string[] }
    : live;

  // Świeży raport można zapisać tylko raz i tylko gdy generowanie się skończyło.
  const canSave =
    !loaded && !!live?.text && !isLoading && !!user && savedId === null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Wczytaj listę zapisanych raportów zalogowanego użytkownika.
  const loadSaved = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("reports")
      .select("id, title, content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Nie udało się wczytać zapisanych raportów.", error);
      return;
    }
    setSaved((data ?? []) as SavedReport[]);
  }, [user]);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  function generate(t: string) {
    const trimmed = t.trim();
    if (!trimmed || isLoading) return;
    setMessages([]); // jeden raport naraz — czyścimy poprzedni
    setLoaded(null);
    setSavedId(null);
    setSaveError(null);
    setCopied(false);
    setTopic(trimmed);
    sendMessage({ text: `Napisz profesjonalny raport na temat: ${trimmed}` });
    setInput("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    generate(input);
  }

  async function copyReport() {
    if (!display?.text) return;
    try {
      await navigator.clipboard.writeText(display.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function downloadReport() {
    if (!display?.text) return;
    const blob = new Blob([display.text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "raport.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveReport() {
    if (!live?.text || !user || saving) return;
    setSaving(true);
    setSaveError(null);
    const title = (topic || "Raport bez tytułu").slice(0, 200);
    const { data, error } = await supabase
      .from("reports")
      .insert({ user_id: user.id, title, content: live.text })
      .select("id, title, content, created_at")
      .single();
    setSaving(false);
    if (error || !data) {
      console.error("Nie udało się zapisać raportu.", error);
      setSaveError("Nie udało się zapisać (sprawdź, czy tabela 'reports' istnieje).");
      return;
    }
    setSavedId(data.id);
    setSaved((prev) => [data as SavedReport, ...prev]);
  }

  function openSaved(r: SavedReport) {
    setMessages([]);
    setLoaded({ title: r.title, text: r.content });
    setTopic(r.title);
    setSavedId(r.id);
    setSaveError(null);
    setCopied(false);
    setPanelOpen(false);
  }

  async function deleteSaved(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const { error } = await supabase
      .from("reports")
      .delete()
      .eq("id", id)
      .eq("user_id", user!.id); // dodatkowy filtr — nie kasuj cudzego
    if (error) {
      console.error("Nie udało się usunąć raportu.", error);
      return;
    }
    setSaved((prev) => prev.filter((r) => r.id !== id));
    if (loaded && savedId === id) {
      setLoaded(null);
      setSavedId(null);
    }
  }

  return (
    <div
      style={{
        maxWidth: 820,
        margin: "0 auto",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "0 16px",
      }}
    >
      <header style={{ padding: "24px 0 12px", textAlign: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>📊 Generator raportów</div>
        <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
          Opisz temat — agent napisze raport biznesowy
        </div>
      </header>

      {/* Formularz tematu */}
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: 8, paddingBottom: 8 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Np. Rynek AI w Polsce w 2026 roku..."
          style={{
            flex: 1,
            background: "#1a1a2a",
            border: "1px solid #333",
            borderRadius: 10,
            color: "#ededed",
            padding: "12px 14px",
            fontSize: 16,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{
            background: "#2a2a3a",
            border: "1px solid #444",
            borderRadius: 10,
            color: "#ededed",
            padding: "0 20px",
            fontSize: 15,
            whiteSpace: "nowrap",
            cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
            opacity: isLoading || !input.trim() ? 0.5 : 1,
          }}
        >
          📊 Generuj raport
        </button>
      </form>

      {/* Pasek "Zapisane raporty" */}
      <div style={{ paddingBottom: 12 }}>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          style={{
            background: "transparent",
            border: "1px solid #333",
            borderRadius: 8,
            color: "#ededed",
            padding: "5px 12px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          📁 Zapisane raporty {saved.length > 0 ? `(${saved.length})` : ""}{" "}
          {panelOpen ? "▲" : "▼"}
        </button>

        {panelOpen && (
          <div
            style={{
              marginTop: 8,
              border: "1px solid #333",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {saved.length === 0 ? (
              <div style={{ padding: "12px 14px", color: "#888", fontSize: 13 }}>
                Brak zapisanych raportów. Wygeneruj raport i kliknij „💾 Zapisz w
                bazie".
              </div>
            ) : (
              saved.map((r) => (
                <div
                  key={r.id}
                  onClick={() => openSaved(r)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 14px",
                    borderBottom: "1px solid #222",
                    cursor: "pointer",
                    background: savedId === r.id && loaded ? "#15151f" : "transparent",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        color: "#ededed",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.title}
                    </div>
                    <div style={{ fontSize: 11, color: "#777" }}>
                      {new Date(r.created_at).toLocaleString("pl-PL")}
                    </div>
                  </div>
                  <button
                    onClick={(e) => deleteSaved(r.id, e)}
                    title="Usuń"
                    style={{
                      background: "transparent",
                      border: "1px solid #3a2a2a",
                      borderRadius: 6,
                      color: "#f0a0a0",
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
        {messages.length === 0 && !loaded && (
          <div style={{ marginTop: 12 }}>
            <p style={{ color: "#888", textAlign: "center", marginBottom: 12 }}>
              Wybierz przykład lub wpisz własny temat:
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                justifyContent: "center",
              }}
            >
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  onClick={() => generate(q)}
                  style={{
                    background: "#1a1a2a",
                    border: "1px solid #333",
                    borderRadius: 10,
                    color: "#ededed",
                    padding: "8px 12px",
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                    maxWidth: 380,
                  }}
                >
                  {q}
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
                  color: "#ddd",
                  background: "#1a1a2a",
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

        {/* Gotowy raport */}
        {display?.text && (
          <>
            {/* Pasek akcji */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                onClick={copyReport}
                style={{
                  background: copied ? "#1a2a1a" : "#1a1a2a",
                  border: `1px solid ${copied ? "#3a7a3a" : "#333"}`,
                  borderRadius: 8,
                  color: copied ? "#9de89d" : "#ededed",
                  padding: "6px 14px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {copied ? "✅ Skopiowano!" : "📋 Kopiuj do schowka"}
              </button>

              {/* Zapis do bazy — tylko dla świeżo wygenerowanego raportu */}
              {!loaded && (
                <button
                  onClick={saveReport}
                  disabled={!canSave || saving}
                  style={{
                    background: savedId ? "#1a2a1a" : "#1a1a2a",
                    border: `1px solid ${savedId ? "#3a7a3a" : "#333"}`,
                    borderRadius: 8,
                    color: savedId ? "#9de89d" : "#ededed",
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
              )}

              <button
                onClick={downloadReport}
                style={{
                  background: "#1a1a2a",
                  border: "1px solid #333",
                  borderRadius: 8,
                  color: "#ededed",
                  padding: "6px 14px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                💾 Pobierz (.md)
              </button>

              {loaded && (
                <span style={{ fontSize: 12, color: "#888" }}>
                  📁 Otwarty z bazy
                </span>
              )}
            </div>

            {saveError && (
              <div
                style={{
                  background: "#2a1a1a",
                  border: "1px solid #a33",
                  borderRadius: 10,
                  color: "#f0b0b0",
                  padding: "8px 12px",
                  fontSize: 13,
                }}
              >
                ⚠️ {saveError}
              </div>
            )}

            <article
              style={{
                background: "#101018",
                border: "1px solid #333",
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
                  color: "#888",
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
        {isLoading && !live?.text && (
          <div
            style={{
              alignSelf: "flex-start",
              background: "#1a1a2a",
              border: "1px solid #333",
              borderRadius: 12,
              padding: "10px 14px",
              color: "#888",
            }}
          >
            ✍️ Agent zbiera dane i pisze raport...
          </div>
        )}

        <div ref={bottomRef} />
      </main>
    </div>
  );
}
