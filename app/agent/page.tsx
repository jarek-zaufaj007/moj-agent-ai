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
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/lib/auth";

// Metadane narzędzi: emoji + etykieta do osi czasu i panelu możliwości.
const TOOL_META: Record<string, { emoji: string; label: string }> = {
  calculator: { emoji: "🧮", label: "Kalkulator" },
  currentDateTime: { emoji: "🕐", label: "Data i czas" },
  google_search: { emoji: "🌐", label: "Wyszukiwarka Google" },
  readWebPage: { emoji: "📄", label: "Czytanie stron WWW" },
  generateImage: { emoji: "🎨", label: "Generowanie obrazów" },
  saveUserName: { emoji: "🙋", label: "Zapamiętanie imienia" },
  saveUserPreference: { emoji: "📌", label: "Zapamiętanie preferencji" },
};

const CAPABILITIES = [
  { emoji: "🧮", text: "Obliczenia matematyczne" },
  { emoji: "🕐", text: "Aktualna data i godzina" },
  { emoji: "🌐", text: "Wyszukiwanie w internecie" },
  { emoji: "📄", text: "Czytanie stron WWW" },
  { emoji: "🎨", text: "Generowanie obrazów" },
  { emoji: "👁️", text: "Analiza wgranych obrazów" },
];

// Scenariusze pokazujące łączenie wielu narzędzi.
const EXAMPLES = [
  "Ile kosztuje iPhone 16 Pro w Polsce i ile to netto bez 23% VAT?",
  "Jaki dziś dzień i ile dni zostało do końca roku?",
  "Znajdź najnowsze wiadomości o AI i podsumuj je w 3 punktach",
  "Wygeneruj logo dla kawiarni w stylu minimalistycznym",
  "Sprawdź kurs euro i przelicz 500 EUR na złotówki",
];

type ToolPart = {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
};

type Part = {
  type: string;
  text?: string;
  url?: string;
  title?: string;
  mediaType?: string;
  toolName?: string;
  state?: string;
  input?: { url?: string; prompt?: string; expression?: string };
  output?: unknown;
  data?: { image?: string; prompt?: string };
};

function messageText(parts: Part[]) {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

// Obrazy wgrane przez użytkownika (file parts).
function messageImages(parts: Part[]) {
  return parts.filter(
    (p) => p.type === "file" && (p.mediaType?.startsWith("image/") ?? false),
  );
}

// Obrazy wygenerowane przez agenta (data-image parts).
function generatedImages(parts: Part[]) {
  return parts.filter(
    (p) => p.type === "data-image" && p.data?.image,
  ) as { data: { image: string; prompt: string } }[];
}

// Nazwa narzędzia z części typu "tool-xxx" lub "dynamic-tool".
function toolNameOf(p: ToolPart): string | null {
  if (p.type === "dynamic-tool") return p.toolName ?? null;
  if (p.type.startsWith("tool-")) return p.type.slice("tool-".length);
  return null;
}

// Oś czasu użytych narzędzi (kolejność wywołań).
function toolTimeline(parts: Part[]) {
  const out: { name: string; detail: string; state: string }[] = [];
  for (const p of parts as ToolPart[]) {
    const name = toolNameOf(p);
    if (!name) continue;
    const input = p.input as
      | { url?: string; prompt?: string; expression?: string }
      | undefined;
    let detail = "";
    if (input?.expression) detail = input.expression;
    else if (input?.url) detail = input.url;
    else if (input?.prompt) detail = input.prompt;
    out.push({ name, detail, state: p.state ?? "" });
  }
  return out;
}

// Zbierz unikalne źródła (source-url).
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

function downloadImage(dataUrl: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `agent-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function AgentPage() {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/agent" }),
    [],
  );
  const { user } = useAuth();
  const { messages, sendMessage, status, setMessages } = useChat({ transport });
  const [input, setInput] = useState("");
  const attach = useImageAttachment();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Powitanie odzywa się raz na sesję (reset przy "Nowa rozmowa").
  const greetedRef = useRef(false);

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Personalizacja (Warsztat 4): tożsamość z logowania (Supabase Auth). user.id
  // to auth.uid() — ten sam identyfikator trzyma user_profiles, więc agent wita
  // po imieniu i pamięta preferencje konta. Pierwsze wejście → zakładamy pusty
  // profil (name = null), żeby agent wiedział, że ma zapytać o imię.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const id = user.id;

    (async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      if (!data) {
        await supabase.from("user_profiles").insert({ id });
      }
      if (!cancelled) setUserId(id);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Powitanie: gdy rozmowa jest pusta, agent odzywa się pierwszy. Treść układa
  // /api/greeting na podstawie profilu — dlatego po odświeżeniu strony wita po
  // imieniu, a nowego użytkownika prosi o imię. Powitanie żyje tylko w UI.
  useEffect(() => {
    if (!userId || messages.length > 0 || greetedRef.current) return;
    greetedRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/greeting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, variant: "agent" }),
        });
        const { greeting } = await res.json();
        if (!greeting || cancelled) return;

        setMessages([
          {
            id: crypto.randomUUID(),
            role: "assistant",
            parts: [{ type: "text", text: greeting }],
          },
        ]);
      } catch (err) {
        // Powitanie jest dodatkiem — jego brak nie może blokować agenta.
        console.warn("Nie udało się pobrać powitania.", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, messages.length, setMessages]);

  // Licznik czasu odpowiedzi.
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
    const files = attach.toFileParts();
    setStartedAt(Date.now());
    setElapsed(0);
    sendMessage(files.length ? { text: trimmed, files } : { text: trimmed }, {
      body: { userId },
    });
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
        <div style={{ fontSize: 24, fontWeight: 700 }}>
          🤖 Agent multi-tool
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Łączę wiele narzędzi, aby rozwiązać złożone zadania
        </div>
      </header>

      {/* Panel możliwości */}
      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "10px 12px",
          marginBottom: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "center",
        }}
      >
        {CAPABILITIES.map((c) => (
          <span
            key={c.text}
            style={{
              fontSize: 12,
              color: "var(--muted-strong)",
              background: "var(--surface-3)",
              border: "1px solid var(--surface-2)",
              borderRadius: 999,
              padding: "3px 10px",
            }}
          >
            ✅ {c.emoji} {c.text}
          </span>
        ))}
      </section>

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
            setStartedAt(null);
            setElapsed(0);
            // Pusta rozmowa → agent przywita się na nowo (z aktualnego profilu).
            greetedRef.current = false;
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
          🗑 Nowa rozmowa
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
          <div style={{ marginTop: 12 }}>
            <p style={{ color: "var(--muted)", textAlign: "center", marginBottom: 12 }}>
              Wypróbuj scenariusz łączący kilka narzędzi:
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
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    color: "var(--text)",
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

        {messages.map((message) => {
          const isUser = message.role === "user";
          const parts = message.parts as Part[];
          const text = messageText(parts);
          const sources = messageSources(parts);
          const timeline = toolTimeline(parts);
          const imgs = messageImages(parts);
          const genImgs = generatedImages(parts);
          const usedModel = (message.metadata as { model?: string } | undefined)
            ?.model;

          return (
            <div
              key={message.id}
              style={{
                alignSelf: isUser ? "flex-end" : "flex-start",
                maxWidth: "88%",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                alignItems: isUser ? "flex-end" : "flex-start",
              }}
            >
              {/* Oś czasu narzędzi */}
              {timeline.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    width: "100%",
                  }}
                >
                  {timeline.map((t, i) => {
                    const meta = TOOL_META[t.name] ?? {
                      emoji: "🔧",
                      label: t.name,
                    };
                    const done =
                      t.state === "output-available" ||
                      t.state === "output-error";
                    return (
                      <span
                        key={`${t.name}-${i}`}
                        style={{
                          fontSize: 11,
                          color: "var(--muted-strong)",
                          background: "var(--surface)",
                          border: "1px solid #3b82f6",
                          borderRadius: 8,
                          padding: "2px 8px",
                        }}
                      >
                        {done ? "✅" : "⏳"} {i + 1}. {meta.emoji} {meta.label}
                        {t.detail ? (
                          <span style={{ color: "var(--muted)" }}>
                            {" — "}
                            {t.detail.length > 60
                              ? t.detail.slice(0, 60) + "…"
                              : t.detail}
                          </span>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Obrazy wgrane przez użytkownika */}
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

              {/* Obrazy wygenerowane przez agenta */}
              {genImgs.map((g, i) => (
                <div
                  key={`gen-${i}`}
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={g.data.image}
                    alt={g.data.prompt}
                    style={{
                      maxWidth: 380,
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                    }}
                  />
                  <button
                    onClick={() => downloadImage(g.data.image)}
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      color: "var(--text)",
                      padding: "4px 12px",
                      fontSize: 13,
                      cursor: "pointer",
                      alignSelf: "flex-start",
                    }}
                  >
                    ⬇ Pobierz obraz
                  </button>
                </div>
              ))}

              {/* Podsumowanie: liczba narzędzi + czas + model */}
              {!isUser && (timeline.length > 0 || usedModel) && (
                <span style={{ fontSize: 11, color: "var(--muted-dim)" }}>
                  Użyto {timeline.length}{" "}
                  {timeline.length === 1 ? "narzędzia" : "narzędzi"}
                  {usedModel ? ` | Model: ${usedModel}` : ""}
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
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "10px 14px",
              color: "var(--muted)",
            }}
          >
            🤖 Pracuję... {elapsed.toFixed(1)}s
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
        {attach.error && (
          <div
            style={{
              background: "var(--danger-bg)",
              border: "1px solid var(--danger-border)",
              borderRadius: 10,
              color: "var(--danger-text)",
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
            placeholder="Zadaj złożone pytanie lub wklej obraz (Ctrl+V)..."
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
    </div>
  );
}
