"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Przykładowe maile z warsztatu — 1 klik wkleja je do textarea.
const PRZYKLAD = `Od: jan.kowalski@firma.pl
Temat: PILNE - Problem z fakturą
Treść: Dzień dobry, mam problem z fakturą FV/2026/001. Kwota jest nieprawidłowa — powinno być 5000 zł a jest 3000 zł. Proszę o PILNĄ korektę. Termin płatności mija jutro.

Od: winner@lucky-prize.com
Temat: Congratulations! You won $1,000,000
Treść: Click here to claim your prize! Limited time offer. Act now!

Od: anna.nowak@partner.pl
Temat: Propozycja współpracy
Treść: Dzień dobry, reprezentuję firmę ABC Solutions. Chcielibyśmy omówić możliwość współpracy w zakresie dostarczania usług IT. Czy możemy umówić się na spotkanie w przyszłym tygodniu?

Od: klient123@gmail.com
Temat: Nie działa usługa od 3 dni
Treść: Witam, od poniedziałku nie mogę się zalogować do panelu klienta. Próbowałem resetować hasło ale nie dostaje maila. To już trzeci dzień! Jeśli nie rozwiążecie tego dziś, zrezygnuję z usługi.

Od: newsletter@branżowy-portal.pl
Temat: Nowe trendy AI w biznesie - raport 2026
Treść: Zapraszamy do lektury naszego najnowszego raportu o zastosowaniach AI w polskich firmach. Pobierz za darmo na naszej stronie.`;

type Priority = "high" | "medium" | "low" | "none";

type MailCard = {
  key: string;
  title: string;
  priority: Priority;
  body: string; // markdown całej sekcji maila
  draft: string; // sam tekst draftu (do kopiowania)
};

// Kolory ramek wg priorytetu.
const PRIORITY_STYLE: Record<Priority, { border: string; bg: string }> = {
  high: { border: "#c0392b", bg: "rgba(192,57,43,0.08)" },
  medium: { border: "#c9a227", bg: "rgba(201,162,39,0.08)" },
  low: { border: "#2e8b57", bg: "rgba(46,139,87,0.08)" },
  none: { border: "#333", bg: "#1a1a2a" },
};

function detectPriority(block: string): Priority {
  if (block.includes("🔴")) return "high";
  if (block.includes("🟡")) return "medium";
  if (block.includes("🟢")) return "low";
  return "none";
}

// Wyciąga temat z nagłówka "### Mail X: temat".
function extractTitle(block: string): string {
  const line = block.split("\n")[0] ?? "";
  return line.replace(/^#+\s*/, "").trim() || "Mail";
}

// Draft = tekst z bloku cytatu (linie zaczynające się od ">") po nagłówku
// "Proponowana odpowiedź". Zdejmujemy markery ">".
function extractDraft(block: string): string {
  const quoted = block
    .split("\n")
    .filter((l) => l.trim().startsWith(">"))
    .map((l) => l.replace(/^\s*>\s?/, ""))
    .join("\n")
    .trim();
  return quoted;
}

// Rozbija cały strumień na karty maili + osobno podsumowanie.
function parseTriage(text: string): { mails: MailCard[]; summary: string } {
  if (!text.trim()) return { mails: [], summary: "" };

  // Wszystko od "PODSUMOWANIE" traktujemy jako podsumowanie.
  const sumIdx = text.search(/#*\s*PODSUMOWANIE/i);
  let mailsPart = text;
  let summary = "";
  if (sumIdx !== -1) {
    mailsPart = text.slice(0, sumIdx);
    summary = text.slice(sumIdx);
  }

  const blocks = mailsPart
    .split(/\n(?=#{1,6}\s+Mail\b)/i)
    .map((b) => b.trim())
    .filter((b) => /^#{1,6}\s+Mail\b/i.test(b));

  const mails: MailCard[] = blocks.map((block, i) => ({
    key: `mail-${i}`,
    title: extractTitle(block),
    priority: detectPriority(block),
    body: block,
    draft: extractDraft(block),
  }));

  return { mails, summary };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard niedostępny — ignorujemy */
        }
      }}
      style={{
        background: "#2a2a3a",
        border: "1px solid #444",
        borderRadius: 8,
        color: "#ededed",
        padding: "5px 12px",
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {copied ? "✅ Skopiowano" : "📋 Kopiuj draft"}
    </button>
  );
}

export default function EmailTriagePage() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const { mails, summary } = parseTriage(output);

  const counts = {
    high: mails.filter((m) => m.priority === "high").length,
    medium: mails.filter((m) => m.priority === "medium").length,
    low: mails.filter((m) => m.priority === "low").length,
  };

  // Textarea rozdzielamy pustą linią → tablica maili.
  function splitEmails(raw: string): string[] {
    return raw
      .split(/\n\s*\n/)
      .map((e) => e.trim())
      .filter(Boolean);
  }

  async function analyze() {
    const emails = splitEmails(input);
    if (emails.length === 0 || loading) return;

    setLoading(true);
    setError("");
    setOutput("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/email-triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(await res.text().catch(() => "Błąd serwera"));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setOutput((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setError(
          "Nie udało się przeanalizować maili (możliwy limit API). Spróbuj ponownie za chwilę.",
        );
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 16px 48px" }}>
      <header style={{ padding: "24px 0 16px", textAlign: "center" }}>
        <div style={{ fontSize: 26, fontWeight: 700 }}>📧 E-mail Triage</div>
        <div style={{ fontSize: 14, color: "#888", marginTop: 6 }}>
          Wklej maile — agent posortuje i napisze odpowiedzi
        </div>
      </header>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Wklej maile tutaj — oddziel je pustą linią..."
        style={{
          width: "100%",
          minHeight: 200,
          background: "#1a1a2a",
          border: "1px solid #333",
          borderRadius: 12,
          color: "#ededed",
          padding: "14px",
          fontSize: 15,
          lineHeight: 1.5,
          outline: "none",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginTop: 12,
        }}
      >
        <button
          type="button"
          onClick={analyze}
          disabled={loading || !input.trim()}
          style={{
            background: "#2a2a3a",
            border: "1px solid #444",
            borderRadius: 10,
            color: "#ededed",
            padding: "10px 20px",
            fontSize: 15,
            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            opacity: loading || !input.trim() ? 0.5 : 1,
          }}
        >
          {loading ? "⏳ Analizuję..." : "📧 Analizuj maile"}
        </button>

        <button
          type="button"
          onClick={() => setInput(PRZYKLAD)}
          disabled={loading}
          style={{
            background: "#1a1a2a",
            border: "1px solid #333",
            borderRadius: 10,
            color: "#ededed",
            padding: "10px 16px",
            fontSize: 14,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          📋 Wklej przykład
        </button>
      </div>

      {error && (
        <div
          style={{
            marginTop: 16,
            background: "rgba(192,57,43,0.1)",
            border: "1px solid #c0392b",
            borderRadius: 10,
            padding: "12px 14px",
            color: "#f0a0a0",
          }}
        >
          {error}
        </div>
      )}

      {/* Pasek podsumowania na górze — liczniki priorytetów */}
      {mails.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            justifyContent: "center",
            marginTop: 24,
            marginBottom: 8,
            fontSize: 15,
          }}
        >
          <span>🔴 {counts.high} pilne</span>
          <span>🟡 {counts.medium} średnie</span>
          <span>🟢 {counts.low} niskie</span>
        </div>
      )}

      {/* Karty maili */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
        {mails.map((mail) => {
          const style = PRIORITY_STYLE[mail.priority];
          return (
            <div
              key={mail.key}
              style={{
                border: `1px solid ${style.border}`,
                borderLeft: `5px solid ${style.border}`,
                background: style.bg,
                borderRadius: 12,
                padding: "14px 18px",
              }}
            >
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {mail.body}
                </ReactMarkdown>
              </div>
              {mail.draft && (
                <div style={{ marginTop: 10 }}>
                  <CopyButton text={mail.draft} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Podsumowanie od agenta */}
      {summary && (
        <div
          style={{
            marginTop: 20,
            border: "1px solid #333",
            background: "#12121c",
            borderRadius: 12,
            padding: "14px 18px",
          }}
        >
          <div className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Zanim pojawią się pierwsze karty — pokaż surowy strumień */}
      {loading && mails.length === 0 && (
        <div style={{ marginTop: 24, color: "#888", textAlign: "center" }}>
          {output ? (
            <div className="markdown" style={{ textAlign: "left" }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
            </div>
          ) : (
            "Agent czyta maile..."
          )}
        </div>
      )}
    </div>
  );
}
