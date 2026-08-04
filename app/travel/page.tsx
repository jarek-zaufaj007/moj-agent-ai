"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Diagnostics } from "@/app/lib/diagnostics";

const TOOL_META: Record<string, { emoji: string; label: string }> = {
  calculator: { emoji: "🧮", label: "Kalkulator" },
  currentDateTime: { emoji: "🕐", label: "Data i czas" },
  readWebPage: { emoji: "📄", label: "Czytanie stron WWW" },
  getWeather: { emoji: "🌦️", label: "Pogoda" },
  getExchangeRate: { emoji: "💱", label: "Kurs waluty (NBP)" },
  getHolidays: { emoji: "📅", label: "Święta" },
  searchWikipedia: { emoji: "📖", label: "Wikipedia" },
  saveNote: { emoji: "📝", label: "Zapis notatki" },
  getNotes: { emoji: "🗂️", label: "Odczyt notatek" },
  google_search: { emoji: "🌐", label: "Wyszukiwarka Google" },
};

const EXAMPLES = [
  "Planuję weekend w Berlinie. Budżet: 2000 PLN",
  "Lecę do Paryża na tydzień w sierpniu",
  "Wycieczka do Pragi z rodziną na 3 dni",
  "Podróż służbowa do Londynu w przyszłym tygodniu",
  "Porównaj Barcelonę i Lizbonę na wakacje",
];

type ToolPart = {
  type: string;
  toolName?: string;
  state?: string;
  input?: Record<string, unknown>;
  output?: unknown;
};

type Part = {
  type: string;
  text?: string;
  url?: string;
  title?: string;
  toolName?: string;
  state?: string;
  input?: Record<string, unknown>;
  output?: unknown;
};

function toolNameOf(p: ToolPart): string | null {
  if (p.type === "dynamic-tool") return p.toolName ?? null;
  if (p.type.startsWith("tool-")) return p.type.slice("tool-".length);
  return null;
}

function toolDetail(input?: Record<string, unknown>): string {
  if (!input) return "";
  const keys = ["city", "currency", "query", "expression", "url", "title", "countryCode"];
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

// Kolor akcentu karty na podstawie nagłówka sekcji (emoji).
function sectionAccent(heading: string): { bg: string; border: string } {
  if (heading.includes("🗺️")) return { bg: "var(--accent-bg)", border: "#3b82f6" };
  if (heading.includes("📋")) return { bg: "var(--accent-bg)", border: "#60a5fa" };
  if (heading.includes("🌤") || heading.includes("🌦")) return { bg: "var(--tint-blue)", border: "#38bdf8" };
  if (heading.includes("💰") || heading.includes("💶") || heading.includes("💱")) return { bg: "var(--tint-amber)", border: "#f59e0b" };
  if (heading.includes("📅")) return { bg: "var(--danger-bg)", border: "#ef4444" };
  if (heading.includes("🏛") || heading.includes("🏰")) return { bg: "var(--tint-purple)", border: "#a78bfa" };
  if (heading.includes("✅")) return { bg: "var(--tint-green)", border: "#22c55e" };
  if (heading.includes("🏆")) return { bg: "var(--tint-gold)", border: "var(--warn-text)" };
  return { bg: "var(--surface-3)", border: "var(--surface-2)" };
}

// Rozbij markdown na sekcje wg nagłówków ## / ###.
type Section = { heading: string; body: string };
function splitSections(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  let preamble = "";

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      if (current) sections.push(current);
      current = { heading: line, body: "" };
    } else if (current) {
      current.body += line + "\n";
    } else {
      preamble += line + "\n";
    }
  }
  if (current) sections.push(current);

  if (preamble.trim()) {
    sections.unshift({ heading: "", body: preamble });
  }
  return sections;
}

function SectionCard({ section }: { section: Section }) {
  const accent = sectionAccent(section.heading);
  const md = (section.heading ? section.heading + "\n" : "") + section.body;
  return (
    <div
      style={{
        background: accent.bg,
        border: `1px solid ${accent.border}`,
        borderLeft: `4px solid ${accent.border}`,
        borderRadius: 12,
        padding: "12px 16px",
        lineHeight: 1.55,
        overflowWrap: "anywhere",
      }}
    >
      <div className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
      </div>
    </div>
  );
}

function ToolCard({
  name,
  detail,
  done,
  index,
}: {
  name: string;
  detail: string;
  done: boolean;
  index: number;
}) {
  const meta = TOOL_META[name] ?? { emoji: "🔧", label: name };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--surface)",
        border: "1px solid #3b82f6",
        borderRadius: 10,
        padding: "6px 12px",
        fontSize: 12,
      }}
    >
      <span style={{ fontWeight: 700, color: "#60a5fa" }}>{index}.</span>
      <span>{meta.emoji}</span>
      <span style={{ fontWeight: 600 }}>{meta.label}</span>
      {detail ? (
        <span style={{ color: "var(--muted)" }}>
          — {detail.length > 50 ? detail.slice(0, 50) + "…" : detail}
        </span>
      ) : null}
      <span style={{ marginLeft: "auto" }}>{done ? "✅" : "⏳"}</span>
    </div>
  );
}

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

export default function TravelPage() {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/travel" }),
    [],
  );
  const { messages, sendMessage, status, setMessages } = useChat({ transport });
  const [input, setInput] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!isLoading) return;
    const id = setInterval(() => {
      if (startedAt) setElapsed((Date.now() - startedAt) / 1000);
    }, 100);
    return () => clearInterval(id);
  }, [isLoading, startedAt]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    setStartedAt(Date.now());
    setElapsed(0);
    sendMessage({ text: trimmed });
    setInput("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
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
        <div style={{ fontSize: 24, fontWeight: 700 }}>✈️ Asystent podróży AI</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Powiedz dokąd jedziesz — agent zaplanuje wszystko
        </div>
      </header>

      <div
        style={{ display: "flex", justifyContent: "center", paddingBottom: 12 }}
      >
        <button
          onClick={() => {
            setMessages([]);
            setInput("");
            setStartedAt(null);
            setElapsed(0);
          }}
          disabled={messages.length === 0}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: messages.length === 0 ? "var(--border-2)" : "var(--text)",
            padding: "4px 12px",
            cursor: messages.length === 0 ? "not-allowed" : "pointer",
            fontSize: 13,
          }}
        >
          🗑 Nowa podróż
        </button>
      </div>

      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          overflowY: "auto",
          paddingBottom: 16,
        }}
      >
        {messages.length === 0 && (
          <div style={{ marginTop: 12 }}>
            <p style={{ color: "var(--muted)", textAlign: "center", marginBottom: 12 }}>
              Wybierz scenariusz albo opisz własną podróż:
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                alignItems: "center",
              }}
            >
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    color: "var(--text)",
                    padding: "10px 14px",
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                    maxWidth: 560,
                    width: "100%",
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => {
          const isUser = message.role === "user";
          const parts = message.parts as Part[];
          const usedModel = (message.metadata as { model?: string } | undefined)
            ?.model;

          if (isUser) {
            const text = parts
              .filter((p) => p.type === "text")
              .map((p) => p.text ?? "")
              .join("");
            return (
              <div
                key={message.id}
                style={{ alignSelf: "flex-end", maxWidth: "88%" }}
              >
                <div
                  style={{
                    background: "var(--surface-2)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  ✈️ {text}
                </div>
              </div>
            );
          }

          // Oś czasu narzędzi + tekst planu jako karty.
          const text = parts
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join("");
          const sections = text.trim() ? splitSections(text) : [];
          const sources = messageSources(parts);

          const toolCards: { name: string; detail: string; done: boolean }[] = [];
          for (const p of parts as ToolPart[]) {
            const name = toolNameOf(p);
            if (!name) continue;
            const done = p.state === "output-available" || p.state === "output-error";
            toolCards.push({ name, detail: toolDetail(p.input), done });
          }
          const isLast = message.id === messages[messages.length - 1]?.id;
          const active = isLoading && isLast;

          return (
            <div
              key={message.id}
              style={{
                alignSelf: "flex-start",
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {toolCards.length > 0 && (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    🔎 Zebrane dane ({toolCards.length}):
                  </span>
                  {toolCards.map((t, i) => (
                    <ToolCard
                      key={i}
                      name={t.name}
                      detail={t.detail}
                      done={t.done}
                      index={i + 1}
                    />
                  ))}
                </div>
              )}

              {sections.map((s, i) => (
                <SectionCard key={i} section={s} />
              ))}

              <Diagnostics
                parts={parts}
                isLoading={active}
                elapsed={elapsed}
                hardLimit={10}
                maxSteps={5}
              />

              {usedModel && (
                <span style={{ fontSize: 11, color: "var(--muted-dim)" }}>
                  Model: {usedModel}
                </span>
              )}

              {sources.length > 0 && (
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
                  <span>🔗 Źródła:</span>
                  {sources.map((s, i) => (
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
            </div>
          );
        })}

        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div
            style={{
              alignSelf: "flex-start",
              background: "var(--accent-bg)",
              border: "1px solid #3b82f6",
              borderRadius: 12,
              padding: "10px 14px",
              color: "var(--muted-strong)",
            }}
          >
            ✈️ Planuję Twoją podróż... {elapsed.toFixed(1)}s
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: "var(--bg)",
          paddingBottom: 24,
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", gap: 8, paddingTop: 12 }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Np. Lecę do Barcelony na weekend..."
            style={{
              flex: 1,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              color: "var(--text)",
              padding: "12px 14px",
              fontSize: 16,
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-2)",
              borderRadius: 10,
              color: "var(--text)",
              padding: "0 20px",
              fontSize: 16,
              cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
              opacity: isLoading || !input.trim() ? 0.5 : 1,
            }}
          >
            Zaplanuj
          </button>
        </form>
      </div>
    </div>
  );
}
