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

const GENERATE_SIMILAR = "Wygeneruj podobny obraz w innym stylu";

const QUESTIONS = [
  "Co widzisz na tym obrazie?",
  "Wyciągnij cały tekst z tego screena",
  "Opisz to w 3 zdaniach",
  "Jakie kolory dominują? Podaj kody HEX",
  GENERATE_SIMILAR,
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

export default function VisionPage() {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/vision" }),
    [],
  );
  const { messages, sendMessage, status, setMessages } = useChat({ transport });
  const [input, setInput] = useState("");
  const attach = useImageAttachment();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Stan generatora "podobny obraz".
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genResult, setGenResult] = useState<{
    original: string;
    image: string;
  } | null>(null);

  const isLoading = status === "submitted" || status === "streaming";
  const hasImages = attach.images.length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, genLoading, genResult]);

  function send(text: string) {
    const trimmed = text.trim();
    if (isLoading) return;
    // Wymagamy obrazu w kontekście (bieżący załącznik albo już wysłany wcześniej).
    if (!trimmed) return;

    const files = attach.toFileParts();
    sendMessage(
      files.length ? { text: trimmed, files } : { text: trimmed },
    );
    attach.clear();
    setInput("");
  }

  async function generateSimilar() {
    const source = attach.images[0]?.url;
    if (!source || genLoading) return;
    setGenLoading(true);
    setGenError(null);
    setGenResult(null);
    try {
      // Krok 1: obraz → prompt (opis + zmiana stylu).
      const pr = await fetch("/api/vision-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: source,
          instruction: "ta sama scena/temat, ale w wyraźnie innym stylu graficznym",
        }),
      });
      const pd = await pr.json();
      if (!pr.ok) {
        setGenError(pd?.error ?? "Nie udało się przeanalizować obrazu.");
        return;
      }
      // Krok 2: prompt → nowy obraz.
      const ir = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: pd.prompt }),
      });
      const id = await ir.json();
      if (!ir.ok) {
        setGenError(id?.error ?? "Nie udało się wygenerować obrazu.");
        return;
      }
      setGenResult({ original: source, image: id.image });
    } catch {
      setGenError("Błąd połączenia z serwerem.");
    } finally {
      setGenLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  function reset() {
    setMessages([]);
    setInput("");
    attach.clear();
    setGenResult(null);
    setGenError(null);
  }

  const showDropZone = messages.length === 0 && !hasImages;

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
        <div style={{ fontSize: 24, fontWeight: 700 }}>👁️ Agent Vision</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Wklej screenshot, wrzuć plik lub przeciągnij obraz
        </div>
      </header>

      <div
        style={{ display: "flex", justifyContent: "center", paddingBottom: 12 }}
      >
        <button
          onClick={reset}
          disabled={messages.length === 0 && !hasImages && !genResult}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color:
              messages.length === 0 && !hasImages && !genResult
                ? "var(--border-2)"
                : "var(--text)",
            padding: "4px 12px",
            cursor:
              messages.length === 0 && !hasImages && !genResult
                ? "not-allowed"
                : "pointer",
            fontSize: 13,
          }}
        >
          🗑 Nowa analiza
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
        {/* Duża strefa paste/drop przed pierwszym obrazem */}
        {showDropZone && (
          <label
            onPaste={attach.handlePaste}
            tabIndex={0}
            style={{
              marginTop: 12,
              border: "2px dashed var(--border)",
              borderRadius: 14,
              padding: "40px 20px",
              textAlign: "center",
              color: "var(--muted-strong)",
              cursor: "pointer",
              outline: "none",
              display: "block",
            }}
          >
            <input
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) void attach.addFiles(files);
                e.target.value = "";
              }}
            />
            <div style={{ fontSize: 15, lineHeight: 2 }}>
              <div>📸 Ctrl+V — wklej screenshot</div>
              <div>📁 Kliknij — wybierz plik</div>
              <div>🖱️ Przeciągnij — upuść obraz</div>
            </div>
          </label>
        )}

        {attach.error && (
          <div
            style={{
              background: "var(--danger-bg)",
              border: "1px solid var(--danger-border)",
              borderRadius: 10,
              color: "var(--danger-text)",
              padding: "10px 14px",
              fontSize: 14,
            }}
          >
            ⚠️ {attach.error}
          </div>
        )}

        {/* Historia rozmowy */}
        {messages.map((message) => {
          const isUser = message.role === "user";
          const parts = message.parts as Part[];
          const text = messageText(parts);
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
                        border: "1px solid var(--border)",
                      }}
                    />
                  ))}
                </div>
              )}
              {text && (
                <div
                  style={{
                    background: isUser ? "var(--surface-2)" : "var(--surface)",
                    border: isUser ? "none" : "1px solid var(--border)",
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
            </div>
          );
        })}

        {isLoading && messages[messages.length - 1]?.role === "user" && (
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
            👁️ Analizuję obraz...
          </div>
        )}

        {/* Generator "podobny obraz" */}
        {genLoading && (
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
            🎨 Generuję podobny obraz... (5-15 sekund)
          </div>
        )}
        {genError && !genLoading && (
          <div
            style={{
              background: "var(--danger-bg)",
              border: "1px solid var(--danger-border)",
              borderRadius: 10,
              color: "var(--danger-text)",
              padding: "10px 14px",
              fontSize: 14,
            }}
          >
            ⚠️ {genError}
          </div>
        )}
        {genResult && !genLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              Oryginał → nowy wariant:
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[genResult.original, genResult.image].map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt={i === 0 ? "oryginał" : "wariant"}
                  style={{
                    maxHeight: 260,
                    maxWidth: "48%",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* Podgląd bieżących załączników + pytania */}
      <div style={{ paddingTop: 4 }}>
        <AttachmentPreview
          images={attach.images}
          onRemove={attach.remove}
          hint="📎 Screenshot — zadaj pytanie o ten obraz"
        />

        {(hasImages || messages.length > 0) && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 8,
            }}
          >
            {QUESTIONS.map((q) => {
              const isGen = q === GENERATE_SIMILAR;
              const disabled = isGen ? !hasImages || genLoading : isLoading;
              return (
                <button
                  key={q}
                  onClick={() => (isGen ? generateSimilar() : send(q))}
                  disabled={disabled}
                  style={{
                    background: isGen ? "var(--ok-bg)" : "var(--surface)",
                    border: `1px solid ${isGen ? "#2a5" : "var(--border)"}`,
                    borderRadius: 999,
                    color: "var(--text)",
                    padding: "6px 12px",
                    fontSize: 13,
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  {q}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: 8,
          padding: "4px 0 24px",
          position: "sticky",
          bottom: 0,
          background: "var(--bg)",
        }}
      >
        <AttachButton onFiles={(f) => void attach.addFiles(f)} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={attach.handlePaste}
          placeholder={
            hasImages
              ? "Zadaj pytanie o obraz..."
              : "Wklej (Ctrl+V) lub dodaj obraz, potem pytaj..."
          }
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
          Wyślij
        </button>
      </form>
    </div>
  );
}
