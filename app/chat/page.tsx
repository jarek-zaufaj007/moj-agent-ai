"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AttachButton,
  AttachmentPreview,
  DropOverlay,
  useImageAttachment,
} from "@/app/lib/imageAttachment";
import { parseSources } from "@/app/lib/sources";
import { SourceFooter } from "@/app/lib/sourceFooter";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/lib/auth";

type ModelKey = "flash" | "pro";

const MODEL_UI: Record<ModelKey, { label: string; emoji: string; hint: string }> = {
  flash: { label: "Flash Lite", emoji: "⚡", hint: "szybki i najtańszy" },
  pro: { label: "Pro", emoji: "🧠", hint: "zaawansowany" },
};

// Etykieta faktycznie użytego modelu (z metadanych odpowiedzi).
function modelBadge(id?: string): { text: string; color: string } | null {
  switch (id) {
    case "gemini-3.1-flash-lite":
      return { text: "⚡ Flash Lite", color: "#3b82f6" };
    case "gemini-3.1-pro-preview":
      return { text: "🧠 Pro", color: "#a855f7" };
    default:
      return id ? { text: id, color: "#666" } : null;
  }
}

const EXAMPLES = [
  "Jak zwiększyć zasięgi na Instagramie?",
  "Zaplanuj kampanię na Meta Ads z budżetem 1000 zł",
  "Jakie treści publikować na TikToku dla e-commerce?",
  "Jak zbudować markę osobistą na LinkedIn?",
];

function messageText(message: { parts: { type: string; text?: string }[] }) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

export default function Home() {
  const { user } = useAuth();
  const { messages, sendMessage, status, setMessages } = useChat();
  const [input, setInput] = useState("");
  const attach = useImageAttachment();
  const [model, setModel] = useState<ModelKey>("flash");
  const [contextOpen, setContextOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Trwałość rozmowy w Supabase.
  const conversationIdRef = useRef<string | null>(null);
  const savedIdsRef = useRef<Set<string>>(new Set());
  const flushingRef = useRef(false);
  // Powitanie odpala się raz na sesję rozmowy (reset przy "Nowa rozmowa").
  const greetedRef = useRef(false);

  const isLoading = status === "submitted" || status === "streaming";

  const totalChars = messages.reduce((sum, m) => sum + messageText(m).length, 0);
  const approxTokens = Math.ceil(totalChars / 4);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // 0) Personalizacja: tożsamość bierzemy z logowania (Supabase Auth, L07).
  // user.id to auth.uid() — ten sam identyfikator trzyma user_profiles, więc
  // agent wita po imieniu i pamięta preferencje danego konta. Pierwsze wejście
  // konta → zakładamy pusty profil.
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

  // 1) Wczytaj rozmowę z Supabase: albo konkretną (z ?conversation=<id>,
  //    np. po kliknięciu "Kontynuuj rozmowę" w historii), albo ostatnią.
  useEffect(() => {
    // Czekamy na tożsamość — bez user.id nie wiemy, czyje rozmowy wczytać.
    if (!userId) return;
    let cancelled = false;

    (async () => {
      const requestedId = new URLSearchParams(window.location.search).get(
        "conversation",
      );

      // Zawsze filtrujemy po user_id — także przy wejściu z ?conversation=<id>,
      // żeby nie dało się otworzyć cudzej rozmowy przez URL.
      const query = supabase
        .from("conversations")
        .select("id")
        .eq("user_id", userId);
      const { data: conv } = requestedId
        ? await query.eq("id", requestedId).maybeSingle()
        : await query.order("updated_at", { ascending: false }).limit(1).maybeSingle();

      if (conv && !cancelled) {
        conversationIdRef.current = conv.id;

        const { data: rows } = await supabase
          .from("messages")
          .select("id, role, content")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: true });

        if (rows && !cancelled) {
          rows.forEach((r) => savedIdsRef.current.add(r.id));
          setMessages(
            rows.map((r) => ({
              id: r.id,
              role: r.role === "assistant" ? "assistant" : "user",
              parts: [{ type: "text", text: r.content ?? "" }],
            })),
          );
        }
      }

      if (!cancelled) setLoadingHistory(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [setMessages, userId]);

  // 1b) Powitanie: gdy rozmowa jest pusta, agent odzywa się pierwszy. Treść
  //     układa /api/greeting na podstawie profilu z user_profiles — dlatego po
  //     restarcie przeglądarki wita po imieniu i pamięta preferencje.
  useEffect(() => {
    if (loadingHistory || !userId || messages.length > 0 || greetedRef.current) {
      return;
    }
    greetedRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/greeting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, model }),
        });
        const { greeting } = await res.json();
        if (!greeting || cancelled) return;

        const id = crypto.randomUUID();
        // Powitanie żyje tylko w UI — nie zapisujemy go w Supabase (stąd wpis
        // w savedIds), bo przy każdym wejściu powstaje na nowo z profilu.
        savedIdsRef.current.add(id);
        setMessages([
          { id, role: "assistant", parts: [{ type: "text", text: greeting }] },
        ]);
      } catch (err) {
        // Powitanie jest dodatkiem — jego brak nie może blokować czatu.
        console.warn("Nie udało się pobrać powitania.", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadingHistory, userId, messages.length, model, setMessages]);

  // 2) Zapis nowych wiadomości do Supabase — w tle, bez blokowania UI.
  useEffect(() => {
    // Nie zapisujemy, dopóki nie skończymy wczytywać historii ani w trakcie streamowania
    // (czekamy na pełną treść odpowiedzi asystenta). Bez user.id nie ma do czego
    // przypisać rozmowy.
    if (loadingHistory || isLoading || !userId) return;

    async function flush() {
      if (flushingRef.current) return;
      flushingRef.current = true;
      try {
        for (const m of messages) {
          if (savedIdsRef.current.has(m.id)) continue;
          const text = messageText(m);
          if (!text.trim()) continue;

          // Pierwsza wiadomość rozmowy → utwórz rekord conversations.
          if (!conversationIdRef.current) {
            const title = text.slice(0, 50);
            const { data: conv, error } = await supabase
              .from("conversations")
              .insert({ title, user_id: userId })
              .select("id")
              .single();
            if (error || !conv) {
              console.error("Supabase: nie udało się utworzyć rozmowy.", error);
              return;
            }
            conversationIdRef.current = conv.id;
          }

          const { error } = await supabase.from("messages").insert({
            conversation_id: conversationIdRef.current,
            role: m.role,
            content: text,
          });
          if (error) {
            console.error("Supabase: nie udało się zapisać wiadomości.", error);
            continue;
          }

          savedIdsRef.current.add(m.id);

          // Odśwież znacznik ostatniej aktywności rozmowy.
          await supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationIdRef.current);
        }
      } finally {
        flushingRef.current = false;
      }
    }

    void flush();
  }, [messages, isLoading, loadingHistory, userId]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    const files = attach.toFileParts();
    sendMessage(
      files.length ? { text: trimmed, files } : { text: trimmed },
      { body: { model, userId } },
    );
    attach.clear();
    setInput("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  function newConversation() {
    setMessages([]);
    setInput("");
    // Rozpocznij czystą sesję — nowy rekord w conversations powstanie
    // przy pierwszej wiadomości (leniwie, żeby nie tworzyć pustych rozmów).
    conversationIdRef.current = null;
    savedIdsRef.current = new Set();
    // Pusta rozmowa → agent przywita się na nowo (efekt 1b).
    greetedRef.current = false;
  }

  async function exportConversation() {
    const text = messages
      .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${messageText(m)}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
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

      {loadingHistory && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,10,10,0.85)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              border: "3px solid #333",
              borderTopColor: "#3b82f6",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span style={{ color: "#888", fontSize: 14 }}>
            Wczytuję rozmowę...
          </span>
          <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
        </div>
      )}

      <header style={{ padding: "24px 0 12px", textAlign: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>
          📢 Maja — Specjalistka ds. marketingu
        </div>
        <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
          Ekspertka od marketingu i social media. Zapytaj mnie o strategię,
          treści i reklamy.
        </div>
      </header>

      {/* Przełącznik modeli */}
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "center",
          paddingBottom: 12,
        }}
      >
        {(Object.keys(MODEL_UI) as ModelKey[]).map((key) => {
          const active = model === key;
          const cfg = MODEL_UI[key];
          return (
            <button
              key={key}
              onClick={() => setModel(key)}
              style={{
                background: active ? "#16324f" : "transparent",
                border: `1px solid ${active ? "#3b82f6" : "#333"}`,
                borderRadius: 999,
                color: active ? "#ededed" : "#888",
                padding: "6px 14px",
                fontSize: 14,
                cursor: "pointer",
                fontWeight: active ? 600 : 400,
              }}
            >
              {cfg.emoji} {cfg.label} ({cfg.hint})
            </button>
          );
        })}
      </div>

      {/* Panel pamięci / kontekstu */}
      <section
        style={{
          border: "1px solid #333",
          borderRadius: 10,
          marginBottom: 12,
          fontSize: 13,
        }}
      >
        <button
          onClick={() => setContextOpen((v) => !v)}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            color: "#aaa",
            padding: "8px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          <span>🧠 Kontekst rozmowy</span>
          <span>{contextOpen ? "▲" : "▼"}</span>
        </button>

        {contextOpen && (
          <div
            style={{
              padding: "0 12px 12px",
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span style={{ color: "#888" }}>
              Wiadomości: {messages.length} | ~Tokeny: {approxTokens}
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={newConversation}
              disabled={messages.length === 0}
              style={{
                background: "transparent",
                border: "1px solid #333",
                borderRadius: 8,
                color: messages.length === 0 ? "#555" : "#ededed",
                padding: "4px 10px",
                cursor: messages.length === 0 ? "not-allowed" : "pointer",
                fontSize: 13,
              }}
            >
              🗑 Nowa rozmowa
            </button>
            <button
              onClick={exportConversation}
              disabled={messages.length === 0}
              style={{
                background: "transparent",
                border: "1px solid #333",
                borderRadius: 8,
                color: messages.length === 0 ? "#555" : "#ededed",
                padding: "4px 10px",
                cursor: messages.length === 0 ? "not-allowed" : "pointer",
                fontSize: 13,
              }}
            >
              {copied ? "✅ Skopiowano!" : "📋 Eksportuj rozmowę"}
            </button>
          </div>
        )}
      </section>

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
              style={{
                color: "#888",
                textAlign: "center",
                marginBottom: 12,
              }}
            >
              Zacznij od przykładowego pytania:
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
          const text = messageText(message);
          // Stopka "📎 Źródło: …" wędruje z treści do osobnego elementu pod
          // dymkiem — w przeciwnym razie widniałaby dwa razy.
          const { body, sources } = isUser
            ? { body: text, sources: [] as string[] }
            : parseSources(text);
          const usedModel = (message.metadata as { model?: string } | undefined)
            ?.model;
          const badge = !isUser ? modelBadge(usedModel) : null;
          const imgs = (
            message.parts as { type: string; url?: string; mediaType?: string }[]
          ).filter(
            (p) =>
              p.type === "file" && (p.mediaType?.startsWith("image/") ?? false),
          );

          return (
            <div
              key={message.id}
              style={{
                alignSelf: isUser ? "flex-end" : "flex-start",
                maxWidth: "80%",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                alignItems: isUser ? "flex-end" : "flex-start",
              }}
            >
              {badge && (
                <span
                  style={{
                    fontSize: 11,
                    color: "#ddd",
                    background: "#1a1a2a",
                    border: `1px solid ${badge.color}`,
                    borderRadius: 999,
                    padding: "1px 8px",
                  }}
                >
                  {badge.text}
                </span>
              )}
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
              {body && (
                <div
                  style={{
                    background: isUser ? "#2a2a3a" : "#1a1a2a",
                    border: isUser ? "none" : "1px solid #333",
                    borderRadius: 12,
                    padding: "10px 14px",
                    lineHeight: 1.5,
                  }}
                >
                  {/* Odpowiedzi agenta renderujemy jako markdown — persona Mai
                      formatuje je nagłówkami, pogrubieniami i listami. Wiadomość
                      użytkownika zostaje surowym tekstem (pre-wrap zachowuje
                      jego łamanie linii). */}
                  {isUser ? (
                    <span style={{ whiteSpace: "pre-wrap" }}>{body}</span>
                  ) : (
                    <div className="markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {body}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
              <SourceFooter sources={sources} />
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
          style={{
            display: "flex",
            gap: 8,
            paddingTop: 4,
          }}
        >
          <AttachButton onFiles={(f) => void attach.addFiles(f)} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={attach.handlePaste}
            placeholder="Napisz wiadomość lub wklej obraz (Ctrl+V)..."
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
