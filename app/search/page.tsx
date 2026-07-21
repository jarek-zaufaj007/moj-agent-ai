"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AttachButton,
  AttachmentPreview,
  DropOverlay,
  useImageAttachment,
} from "@/app/lib/imageAttachment";

const EXAMPLES = [
  "Jakie są najnowsze wiadomości o sztucznej inteligencji?",
  "Ile kosztuje iPhone 16 Pro w Polsce?",
  "Kto wygrał ostatni mecz reprezentacji Polski?",
  "Jakie filmy są teraz w kinach?",
];

type Part = {
  type: string;
  text?: string;
  url?: string;
  title?: string;
  sourceId?: string;
  state?: string;
  mediaType?: string;
  input?: { url?: string };
};

function messageImages(parts: Part[]) {
  return parts.filter(
    (p) => p.type === "file" && (p.mediaType?.startsWith("image/") ?? false),
  );
}

function messageText(parts: Part[]) {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

// Zbierz unikalne źródła (source-url) z części wiadomości.
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

// Wypisz aktywność narzędzia readWebPage (czytanie strony).
function readActivity(parts: Part[]) {
  return parts
    .filter((p) => p.type === "tool-readWebPage" && p.input?.url)
    .map((p) => p.input!.url as string);
}

export default function SearchPage() {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/search" }),
    [],
  );
  const { messages, sendMessage, status, setMessages } = useChat({ transport });
  const [input, setInput] = useState("");
  const attach = useImageAttachment();
  const bottomRef = useRef<HTMLDivElement>(null);

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    const files = attach.toFileParts();
    sendMessage(files.length ? { text: trimmed, files } : { text: trimmed });
    attach.clear();
    setInput("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <div
      {...attach.dropHandlers}
      style={{
        maxWidth: 800,
        margin: "0 auto",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "0 16px",
      }}
    >
      <DropOverlay show={attach.dragging} />
      <header style={{ padding: "24px 0 12px", textAlign: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>
          🌐 Agent z wyszukiwarką
        </div>
        <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
          Przeszukuję prawdziwy internet i czytam strony
        </div>
      </header>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          paddingBottom: 12,
        }}
      >
        <button
          onClick={() => {
            setMessages([]);
            setInput("");
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
          🗑 Nowe wyszukiwanie
        </button>
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
        {messages.length === 0 && (
          <div style={{ marginTop: 24 }}>
            <p
              style={{ color: "#888", textAlign: "center", marginBottom: 12 }}
            >
              Zapytaj o cokolwiek aktualnego...
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
                  onClick={() => send(q)}
                  style={{
                    background: "#1a1a2a",
                    border: "1px solid #333",
                    borderRadius: 10,
                    color: "#ededed",
                    padding: "8px 12px",
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                    maxWidth: 360,
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
          const text = messageText(parts);
          const sources = messageSources(parts);
          const reads = readActivity(parts);
          const imgs = messageImages(parts);

          return (
            <div
              key={message.id}
              style={{
                alignSelf: isUser ? "flex-end" : "flex-start",
                maxWidth: "85%",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                alignItems: isUser ? "flex-end" : "flex-start",
              }}
            >
              {reads.map((url, i) => (
                <span
                  key={`read-${i}`}
                  style={{
                    fontSize: 11,
                    color: "#ddd",
                    background: "#1a1a2a",
                    border: "1px solid #3b82f6",
                    borderRadius: 999,
                    padding: "1px 8px",
                  }}
                >
                  📄 Czytam: {url}
                </span>
              ))}

              {imgs.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {imgs.map((img, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={img.url}
                      alt="załącznik"
                      style={{
                        maxHeight: 160,
                        maxWidth: 240,
                        borderRadius: 10,
                        border: "1px solid #333",
                      }}
                    />
                  ))}
                </div>
              )}

              {text && (
              <div
                style={{
                  background: isUser ? "#2a2a3a" : "#1a1a2a",
                  border: isUser ? "none" : "1px solid #333",
                  borderRadius: 12,
                  padding: "10px 14px",
                  lineHeight: 1.5,
                  overflowWrap: "anywhere",
                }}
              >
                {isUser ? (
                  <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>
                ) : (
                  <div className="markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {text}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
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
              background: "#1a1a2a",
              border: "1px solid #333",
              borderRadius: 12,
              padding: "10px 14px",
              color: "#888",
            }}
          >
            🔍 Szukam w internecie...
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
        {attach.error && (
          <div
            style={{
              background: "#2a1a1a",
              border: "1px solid #a33",
              borderRadius: 10,
              color: "#f0b0b0",
              padding: "8px 12px",
              fontSize: 13,
              marginBottom: 8,
            }}
          >
            ⚠️ {attach.error}
          </div>
        )}
        <AttachmentPreview images={attach.images} onRemove={attach.remove} />
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", gap: 8, paddingTop: 12 }}
        >
          <AttachButton onFiles={(f) => void attach.addFiles(f)} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={attach.handlePaste}
            placeholder="Zapytaj o cokolwiek aktualnego..."
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
            Szukaj
          </button>
        </form>
      </div>
    </div>
  );
}
