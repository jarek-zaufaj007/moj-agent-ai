"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";

function messageText(message: { parts: { type: string; text?: string }[] }) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

export default function ThinkPage() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/think" }),
  });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    sendMessage({ text });
    setInput("");
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
        <div style={{ fontSize: 24, fontWeight: 700 }}>
          🧠 Tryb głębokiego myślenia
        </div>
        <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
          Agent pokazuje tok rozumowania krok po kroku
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
            Zadaj trudne pytanie — zobaczysz cały proces myślenia.
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
                maxWidth: "85%",
                background: isUser ? "#2a2a3a" : "#1a1a2a",
                border: isUser ? "none" : "1px solid #333",
                borderRadius: 12,
                padding: "10px 14px",
                whiteSpace: "pre-wrap",
                lineHeight: 1.5,
              }}
            >
              {text}
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
            Myślę...
          </div>
        )}

        <div ref={bottomRef} />
      </main>

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
          placeholder="Zadaj trudne pytanie..."
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
