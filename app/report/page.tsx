"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/report" }),
    [],
  );
  const { messages, sendMessage, status, setMessages } = useChat({ transport });
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isLoading = status === "submitted" || status === "streaming";

  // Ostatnia odpowiedź agenta = gotowy raport (pracujemy z jednym naraz).
  const report = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last) return null;
    const parts = last.parts as Part[];
    return {
      text: messageText(parts),
      sources: messageSources(parts),
      acts: activity(parts),
    };
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function generate(topic: string) {
    const trimmed = topic.trim();
    if (!trimmed || isLoading) return;
    setMessages([]); // jeden raport naraz — czyścimy poprzedni
    setCopied(false);
    sendMessage({ text: `Napisz profesjonalny raport na temat: ${trimmed}` });
    setInput("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    generate(input);
  }

  async function copyReport() {
    if (!report?.text) return;
    try {
      await navigator.clipboard.writeText(report.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function downloadReport() {
    if (!report?.text) return;
    const blob = new Blob([report.text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "raport.md";
    a.click();
    URL.revokeObjectURL(url);
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
        style={{ display: "flex", gap: 8, paddingBottom: 12 }}
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
        {report?.acts && report.acts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {report.acts.map((a, i) => (
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
        {report?.text && (
          <>
            {/* Pasek akcji */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
            </div>

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
                  {report.text}
                </ReactMarkdown>
              </div>
            </article>

            {report.sources.length > 0 && (
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
                {report.sources.map((s, i) => (
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
        {isLoading && !report?.text && (
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
