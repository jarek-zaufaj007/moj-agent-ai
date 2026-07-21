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

// Przykładowe dokumenty do szybkiego testu (bez obrazu).
const EXAMPLES = [
  {
    label: "🧾 Paragon",
    text: `Sklep Groszek, ul. Kwiatowa 5, Kraków. NIP 676-123-45-67.
2026-06-14 18:42. Chleb 4,50; Mleko 3,20; Masło 2x 8,90; Kawa 24,99.
SUMA 50,49 PLN. Płatność: karta.`,
  },
  {
    label: "💳 Wizytówka",
    text: `Anna Kowalska
Senior Product Manager, Syntelligence Sp. z o.o.
anna.kowalska@syntelligence.ai | +48 512 340 567
ul. Wielicka 28, 30-552 Kraków | syntelligence.ai`,
  },
  {
    label: "📧 E-mail",
    text: `Od: biuro@hotelmorski.pl
Temat: Potwierdzenie rezerwacji #RZ-2048
Witamy, potwierdzamy pobyt 2-osobowy 12-15.08.2026,
pokój Deluxe, śniadania w cenie. Do zapłaty 1350 zł.`,
  },
  {
    label: "🏢 Ogłoszenie",
    text: `Wynajmę 2-pokojowe mieszkanie, 48 m2, Kraków Podgórze.
Czynsz 2800 zł + 600 zł opłaty. Kaucja 2800 zł.
Dostępne od 1 września. Kontakt: 600 100 200.`,
  },
];

type Part = {
  type: string;
  text?: string;
  url?: string;
  mediaType?: string;
};

function messageText(parts: Part[]) {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

function messageImages(parts: Part[]) {
  return parts.filter(
    (p) => p.type === "file" && (p.mediaType?.startsWith("image/") ?? false),
  );
}

export default function ExtractPage() {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/extract" }),
    [],
  );
  const { messages, sendMessage, status, setMessages } = useChat({ transport });
  const [input, setInput] = useState("");
  const attach = useImageAttachment();
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function send(text: string) {
    const trimmed = text.trim();
    const files = attach.toFileParts();
    // Analiza wymaga tekstu ALBO obrazu.
    if ((!trimmed && files.length === 0) || isLoading) return;
    const payload = trimmed || "Wyodrębnij dane z tego obrazu.";
    sendMessage(files.length ? { text: payload, files } : { text: payload });
    attach.clear();
    setInput("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  // Skopiuj blok JSON z ostatniej odpowiedzi analizatora.
  function copyJson(text: string) {
    const match = text.match(/```json\s*([\s\S]*?)```/i);
    const json = match ? match[1].trim() : text;
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div
      {...attach.dropHandlers}
      style={{
        maxWidth: 820,
        margin: "0 auto",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "0 16px",
      }}
    >
      <DropOverlay show={attach.dragging} />
      <header style={{ padding: "24px 0 12px", textAlign: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>📊 Analizator</div>
        <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
          Wyciąga dane ustrukturyzowane z tekstu lub obrazu (JSON + tabela)
        </div>
      </header>

      <div
        style={{ display: "flex", justifyContent: "center", paddingBottom: 12 }}
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
          🗑 Wyczyść
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
          <div style={{ marginTop: 8 }}>
            <p
              style={{ color: "#888", textAlign: "center", marginBottom: 12 }}
            >
              Wklej tekst, wgraj/wklej obraz (Ctrl+V) albo wypróbuj przykład:
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                justifyContent: "center",
              }}
            >
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  onClick={() => send(ex.text)}
                  style={{
                    background: "#1a1a2a",
                    border: "1px solid #333",
                    borderRadius: 10,
                    color: "#ededed",
                    padding: "8px 12px",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => {
          const isUser = message.role === "user";
          const parts = message.parts as Part[];
          const text = messageText(parts);
          const imgs = messageImages(parts);
          const usedModel = (message.metadata as { model?: string } | undefined)
            ?.model;
          const hasJson = /```json/i.test(text);

          return (
            <div
              key={message.id}
              style={{
                alignSelf: isUser ? "flex-end" : "flex-start",
                maxWidth: "92%",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                alignItems: isUser ? "flex-end" : "flex-start",
              }}
            >
              {imgs.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {imgs.map((img, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={img.url}
                      alt="dokument"
                      style={{
                        maxHeight: 180,
                        maxWidth: 260,
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
                    width: isUser ? undefined : "100%",
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

              {!isUser && hasJson && (
                <button
                  onClick={() => copyJson(text)}
                  style={{
                    background: "#1a1a2a",
                    border: "1px solid #333",
                    borderRadius: 8,
                    color: "#ededed",
                    padding: "4px 12px",
                    fontSize: 13,
                    cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  {copied ? "✅ Skopiowano" : "📋 Kopiuj JSON"}
                </button>
              )}

              {!isUser && usedModel && (
                <span style={{ fontSize: 11, color: "#666" }}>
                  Model: {usedModel}
                </span>
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
            📊 Analizuję dokument...
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
        <AttachmentPreview
          images={attach.images}
          onRemove={attach.remove}
          hint="Dokument do analizy:"
        />
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", gap: 8, paddingTop: 12 }}
        >
          <AttachButton onFiles={(f) => void attach.addFiles(f)} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={attach.handlePaste}
            placeholder="Wklej tekst lub obraz (Ctrl+V) do analizy..."
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
            disabled={isLoading || (!input.trim() && attach.images.length === 0)}
            style={{
              background: "#2a2a3a",
              border: "1px solid #444",
              borderRadius: 10,
              color: "#ededed",
              padding: "0 20px",
              fontSize: 16,
              cursor:
                isLoading || (!input.trim() && attach.images.length === 0)
                  ? "not-allowed"
                  : "pointer",
              opacity:
                isLoading || (!input.trim() && attach.images.length === 0)
                  ? 0.5
                  : 1,
            }}
          >
            Analizuj
          </button>
        </form>
      </div>
    </div>
  );
}
