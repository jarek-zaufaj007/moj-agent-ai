"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/lib/auth";

type Message = {
  id: string;
  role: string | null;
  content: string | null;
  created_at: string;
};

type Conversation = {
  id: string;
  title: string | null;
  updated_at: string;
};

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ConversationPreviewPage() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id || !user) return;
    let cancelled = false;

    (async () => {
      // Filtr user_id: podgląd tylko własnej rozmowy (cudze id → "nie znaleziono").
      const { data: conv } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!conv) {
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
        return;
      }

      const { data: rows } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true });

      if (!cancelled) {
        setConversation(conv);
        setMessages(rows ?? []);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, user]);

  return (
    <div
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "24px 16px 48px",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <Link
          href="/history"
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text)",
            padding: "6px 12px",
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          ← Wróć do listy
        </Link>
        <Link
          href={`/chat?conversation=${id}`}
          style={{
            background: "var(--accent-bg)",
            border: "1px solid #3b82f6",
            borderRadius: 8,
            color: "var(--text)",
            padding: "6px 12px",
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          🔄 Kontynuuj rozmowę
        </Link>
      </div>

      {loading && (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: "40px 0" }}>
          Wczytuję rozmowę...
        </div>
      )}

      {!loading && notFound && (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: "40px 0" }}>
          Nie znaleziono tej rozmowy.
        </div>
      )}

      {!loading && conversation && (
        <>
          <header style={{ marginBottom: 20 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              {conversation.title?.trim() || "Rozmowa bez tytułu"}
            </h1>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
              {new Date(conversation.updated_at).toLocaleString("pl-PL", {
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </header>

          <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.length === 0 && (
              <div style={{ color: "var(--muted)", textAlign: "center" }}>
                Ta rozmowa nie zawiera wiadomości.
              </div>
            )}

            {messages.map((m) => {
              const isUser = m.role !== "assistant";
              return (
                <div
                  key={m.id}
                  style={{
                    alignSelf: isUser ? "flex-end" : "flex-start",
                    maxWidth: "80%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    alignItems: isUser ? "flex-end" : "flex-start",
                  }}
                >
                  <span style={{ fontSize: 11, color: "var(--muted-dim)" }}>
                    {isUser ? "Ty" : "Maja"} · {timeLabel(m.created_at)}
                  </span>
                  <div
                    style={{
                      background: isUser ? "var(--surface-2)" : "var(--surface)",
                      border: isUser ? "none" : "1px solid var(--border)",
                      borderRadius: 12,
                      padding: "10px 14px",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.5,
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              );
            })}
          </main>
        </>
      )}
    </div>
  );
}
