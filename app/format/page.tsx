"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const COMMANDS = [
  "/tabela języki programowania 2026",
  "/porownanie ChatGPT vs Claude",
  "/lista 5 kroków do pierwszego agenta AI",
  "/faq sztuczna inteligencja dla początkujących",
  "/email podziękowanie za udaną rekrutację",
];

function messageText(message: { parts: { type: string; text?: string }[] }) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

export default function FormatPage() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/format" }),
  });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
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
        maxWidth: 800,
        margin: "0 auto",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "0 16px",
      }}
    >
      <header style={{ padding: "24px 0 16px", textAlign: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>📐 Formatowanie</div>
        <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
          Agent odpowiada w tabeli, liście, porównaniu — na żądanie
        </div>
      </header>

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
          <p style={{ color: "#888", textAlign: "center", marginTop: 40 }}>
            Wybierz komendę poniżej albo wpisz własną (np. /tabela, /lista,
            /porownanie, /faq, /email).
          </p>
        )}

        {messages.map((message) => {
          const isUser = message.role === "user";
          const text = messageText(message);

          return (
            <div
              key={message.id}
              style={{
                alignSelf: isUser ? "flex-end" : "flex-start",
                maxWidth: isUser ? "85%" : "100%",
                width: isUser ? "auto" : "100%",
                background: isUser ? "#2a2a3a" : "#1a1a2a",
                border: isUser ? "none" : "1px solid #333",
                borderRadius: 12,
                padding: "10px 14px",
                lineHeight: 1.5,
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
            Formatuję...
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "center",
          paddingBottom: 12,
        }}
      >
        {COMMANDS.map((cmd) => (
          <button
            key={cmd}
            type="button"
            onClick={() => setInput(cmd)}
            style={{
              background: "#1a1a2a",
              border: "1px solid #333",
              borderRadius: 999,
              color: "#ededed",
              padding: "6px 14px",
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            {cmd}
          </button>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: 8,
          padding: "12px 0 24px",
          position: "sticky",
          bottom: 0,
          background: "#0a0a0a",
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Wpisz komendę lub pytanie..."
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
  );
}
