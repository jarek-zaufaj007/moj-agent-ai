"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Diagnostics } from "@/app/lib/diagnostics";

// Metadane narzędzi: emoji + etykieta.
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

// Złożone, wielokrokowe scenariusze.
const EXAMPLES = [
  "Planuję weekend w Krakowie. Sprawdź pogodę, znajdź ciekawe miejsca w Wikipedii, i powiedz czy są jakieś święta w ten weekend",
  "Mam 5000 EUR do wydania. Przelicz na PLN, sprawdź ile to w dolarach, i zapisz wszystkie kursy w notatkach",
  "Porównaj pogodę w Warszawie, Berlinie i Paryżu. Który z tych miast ma dziś najlepszą pogodę?",
  "Ile dni do następnego święta w Polsce? Jaka będzie wtedy pogoda?",
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

// Nazwa narzędzia z części typu "tool-xxx" lub "dynamic-tool".
function toolNameOf(p: ToolPart): string | null {
  if (p.type === "dynamic-tool") return p.toolName ?? null;
  if (p.type.startsWith("tool-")) return p.type.slice("tool-".length);
  return null;
}

// Krótki opis wejścia narzędzia (do karty).
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

// Klasyfikacja bloku tekstu wg nagłówka ReAct.
type BlockKind = "think" | "observe" | "result" | "plain";
type Block = { kind: BlockKind; text: string };

function splitBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let current: Block | null = null;

  const kindOf = (line: string): BlockKind | null => {
    if (!/^#{1,6}\s/.test(line)) return null;
    if (line.includes("🧠")) return "think";
    if (line.includes("👁")) return "observe";
    if (line.includes("✅")) return "result";
    return null;
  };

  for (const line of lines) {
    const k = kindOf(line);
    if (k) {
      if (current) blocks.push(current);
      current = { kind: k, text: line + "\n" };
    } else if (current) {
      current.text += line + "\n";
    } else {
      current = { kind: "plain", text: line + "\n" };
    }
  }
  if (current) blocks.push(current);
  return blocks.filter((b) => b.text.trim().length > 0);
}

const BLOCK_STYLE: Record<BlockKind, { bg: string; border: string }> = {
  think: { bg: "#1a1a3a", border: "#3b82f6" },
  observe: { bg: "#2a1a0a", border: "#f59e0b" },
  result: { bg: "#0a2a0a", border: "#22c55e" },
  plain: { bg: "#141422", border: "#2a2a3a" },
};

function BlockView({ block }: { block: Block }) {
  const s = BLOCK_STYLE[block.kind];
  return (
    <div
      style={{
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 12,
        padding: "10px 14px",
        lineHeight: 1.5,
        overflowWrap: "anywhere",
      }}
    >
      <div className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
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
        background: "#12122a",
        border: "1px solid #7c3aed",
        borderRadius: 10,
        padding: "8px 12px",
        fontSize: 13,
      }}
    >
      <span style={{ fontWeight: 700, color: "#a78bfa" }}>⚡ {index}.</span>
      <span>{meta.emoji}</span>
      <span style={{ fontWeight: 600 }}>{meta.label}</span>
      {detail ? (
        <span style={{ color: "#999" }}>
          — {detail.length > 60 ? detail.slice(0, 60) + "…" : detail}
        </span>
      ) : null}
      <span style={{ marginLeft: "auto" }}>{done ? "✅" : "⏳"}</span>
    </div>
  );
}

// Sekwencja renderowana w kolejności części wiadomości (text bloki + karty narzędzi).
type FlowItem =
  | { kind: "block"; block: Block }
  | { kind: "tool"; name: string; detail: string; done: boolean };

function buildFlow(parts: Part[]): { items: FlowItem[]; steps: number } {
  const items: FlowItem[] = [];
  let steps = 0;
  for (const p of parts) {
    if (p.type === "text" && p.text) {
      for (const b of splitBlocks(p.text)) {
        if (b.kind === "think") steps++;
        items.push({ kind: "block", block: b });
      }
    } else {
      const name = toolNameOf(p as ToolPart);
      if (name) {
        const done = p.state === "output-available" || p.state === "output-error";
        items.push({ kind: "tool", name, detail: toolDetail(p.input), done });
      }
    }
  }
  return { items, steps };
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

const MAX_STEPS = 5;

export default function ReactPage() {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/react" }),
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

  // Postęp: liczba kroków 🧠 w ostatniej wiadomości agenta.
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const liveSteps = lastAssistant
    ? buildFlow(lastAssistant.parts as Part[]).steps
    : 0;
  const progress = Math.min(liveSteps || (isLoading ? 1 : 0), MAX_STEPS);

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
        <div style={{ fontSize: 24, fontWeight: 700 }}>
          🔄 Agent ReAct — Autonomiczne rozumowanie
        </div>
        <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
          Opisz cel → agent sam planuje i realizuje
        </div>
      </header>

      {/* Progress bar */}
      {(isLoading || progress > 0) && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              color: "#aaa",
              marginBottom: 4,
            }}
          >
            <span>
              Krok {Math.max(progress, 1)} z {MAX_STEPS}
            </span>
            {isLoading && <span>⏱ {elapsed.toFixed(1)}s</span>}
          </div>
          <div
            style={{
              height: 6,
              background: "#1a1a2a",
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${(Math.max(progress, 1) / MAX_STEPS) * 100}%`,
                background: "linear-gradient(90deg,#3b82f6,#22c55e)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

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
            border: "1px solid #333",
            borderRadius: 8,
            color: messages.length === 0 ? "#555" : "#ededed",
            padding: "4px 12px",
            cursor: messages.length === 0 ? "not-allowed" : "pointer",
            fontSize: 13,
          }}
        >
          🗑 Nowy cel
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
            <p style={{ color: "#888", textAlign: "center", marginBottom: 12 }}>
              Wypróbuj złożony, wielokrokowy cel:
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
                    background: "#1a1a2a",
                    border: "1px solid #333",
                    borderRadius: 10,
                    color: "#ededed",
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
                    background: "#2a2a3a",
                    borderRadius: 12,
                    padding: "10px 14px",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  🎯 {text}
                </div>
              </div>
            );
          }

          const { items } = buildFlow(parts);
          const sources = messageSources(parts);
          const isLast = message.id === messages[messages.length - 1]?.id;
          const active = isLoading && isLast;
          let toolIndex = 0;

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
              {items.map((item, i) => {
                if (item.kind === "tool") {
                  toolIndex++;
                  return (
                    <ToolCard
                      key={`t-${i}`}
                      name={item.name}
                      detail={item.detail}
                      done={item.done}
                      index={toolIndex}
                    />
                  );
                }
                return <BlockView key={`b-${i}`} block={item.block} />;
              })}

              <Diagnostics
                parts={parts}
                isLoading={active}
                elapsed={elapsed}
                hardLimit={8}
                maxSteps={MAX_STEPS}
              />

              {usedModel && (
                <span style={{ fontSize: 11, color: "#666" }}>
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
                    color: "#888",
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
              background: "#1a1a3a",
              border: "1px solid #3b82f6",
              borderRadius: 12,
              padding: "10px 14px",
              color: "#aab",
            }}
          >
            🧠 Myślę... {elapsed.toFixed(1)}s
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: "#0a0a0a",
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
            placeholder="Opisz co chcesz osiągnąć..."
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
              fontSize: 16,
              cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
              opacity: isLoading || !input.trim() ? 0.5 : 1,
            }}
          >
            Wyślij
          </button>
        </form>
      </div>
    </div>
  );
}
