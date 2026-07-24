"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/lib/auth";

// Rozmowa wzbogacona o dane potrzebne na karcie (liczba wiadomości, podgląd).
type ConversationCard = {
  id: string;
  title: string | null;
  updated_at: string;
  messageCount: number;
  lastMessage: string;
};

// Data ostatniej aktywności w przyjaznej formie ("2 godziny temu", "wczoraj",
// "15 czerwca 2026").
function relativeDate(iso: string): string {
  const then = new Date(iso);
  const diffMs = Date.now() - then.getTime();
  const min = Math.floor(diffMs / 60000);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);

  if (min < 1) return "przed chwilą";
  if (min < 60) return `${min} min temu`;
  if (hour < 24) return `${hour} godz. temu`;
  if (day === 1) return "wczoraj";
  if (day < 7) return `${day} dni temu`;
  return then.toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function shorten(text: string, max = 100): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

export default function HistoryPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Pobierz listę rozmów wraz z liczbą wiadomości i podglądem ostatniej.
  // Tylko rozmowy zalogowanego użytkownika (filtr po user_id).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const { data: convs, error } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("Supabase: nie udało się pobrać rozmów.", error);
        if (!cancelled) setLoading(false);
        return;
      }

      // Dla każdej rozmowy dobierz liczbę wiadomości i ostatnią wiadomość.
      const cards = await Promise.all(
        (convs ?? []).map(async (c) => {
          const { count } = await supabase
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", c.id);

          const { data: last } = await supabase
            .from("messages")
            .select("content")
            .eq("conversation_id", c.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          return {
            id: c.id,
            title: c.title,
            updated_at: c.updated_at,
            messageCount: count ?? 0,
            lastMessage: last?.content ?? "",
          } satisfies ConversationCard;
        }),
      );

      if (!cancelled) {
        setConversations(cards);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Filtrowanie (bonus): szukaj w tytule LUB w podglądzie ostatniej wiadomości.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        (c.title ?? "").toLowerCase().includes(q) ||
        c.lastMessage.toLowerCase().includes(q),
    );
  }, [conversations, search]);

  async function remove(id: string) {
    const ok = window.confirm(
      "Czy na pewno chcesz usunąć tę rozmowę? Tej operacji nie można cofnąć.",
    );
    if (!ok) return;

    setDeleting(id);
    // Kasujemy wiadomości, a potem samą rozmowę (na wypadek braku ON DELETE CASCADE).
    // Dodatkowy filtr user_id chroni przed usunięciem cudzej rozmowy.
    await supabase.from("messages").delete().eq("conversation_id", id);
    const del = supabase.from("conversations").delete().eq("id", id);
    const { error } = user ? await del.eq("user_id", user.id) : await del;
    setDeleting(null);

    if (error) {
      console.error("Supabase: nie udało się usunąć rozmowy.", error);
      setToast("Nie udało się usunąć rozmowy");
      setTimeout(() => setToast(null), 2500);
      return;
    }

    // Odśwież listę bez przeładowania strony.
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setToast("Rozmowa usunięta");
    setTimeout(() => setToast(null), 2500);
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 16px 48px" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>
          📜 Historia rozmów
        </h1>
        <p style={{ color: "#888", marginTop: 6, fontSize: 14 }}>
          Wszystkie Twoje rozmowy z agentem
        </p>
      </header>

      {/* Wyszukiwarka */}
      {conversations.length > 0 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Szukaj w rozmowach..."
          style={{
            width: "100%",
            background: "#1a1a2a",
            border: "1px solid #333",
            borderRadius: 10,
            color: "#ededed",
            padding: "10px 14px",
            fontSize: 15,
            outline: "none",
            marginBottom: 20,
          }}
        />
      )}

      {loading && (
        <div style={{ color: "#888", textAlign: "center", padding: "40px 0" }}>
          Wczytuję rozmowy...
        </div>
      )}

      {/* Pusta lista */}
      {!loading && conversations.length === 0 && (
        <div
          style={{
            border: "1px dashed #333",
            borderRadius: 12,
            padding: "40px 24px",
            textAlign: "center",
            color: "#888",
          }}
        >
          <p style={{ marginBottom: 16 }}>
            Nie masz jeszcze żadnych rozmów. Zacznij nową!
          </p>
          <Link
            href="/chat"
            style={{
              display: "inline-block",
              background: "#16324f",
              border: "1px solid #3b82f6",
              borderRadius: 10,
              color: "#ededed",
              padding: "10px 18px",
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            Rozpocznij rozmowę
          </Link>
        </div>
      )}

      {/* Brak wyników wyszukiwania */}
      {!loading && conversations.length > 0 && filtered.length === 0 && (
        <div style={{ color: "#888", textAlign: "center", padding: "24px 0" }}>
          Brak rozmów pasujących do „{search}”.
        </div>
      )}

      {/* Lista rozmów */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.map((c) => (
          <div
            key={c.id}
            className="history-card"
            style={{
              position: "relative",
              background: "#1a1a2a",
              border: "1px solid #333",
              borderRadius: 12,
              padding: 16,
              transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <Link
              href={`/history/${c.id}`}
              style={{ textDecoration: "none", color: "inherit", display: "block" }}
            >
              <div
                style={{
                  fontWeight: 700,
                  color: "#fff",
                  fontSize: 16,
                  paddingRight: 90,
                }}
              >
                {c.title?.trim() || "Rozmowa bez tytułu"}
              </div>
              <div
                style={{
                  color: "#888",
                  fontSize: 12,
                  marginTop: 4,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span>{relativeDate(c.updated_at)}</span>
                <span>·</span>
                <span>{c.messageCount} wiadomości</span>
              </div>
              {c.lastMessage && (
                <div
                  style={{
                    color: "#999",
                    fontStyle: "italic",
                    fontSize: 13,
                    marginTop: 8,
                  }}
                >
                  {shorten(c.lastMessage)}
                </div>
              )}
            </Link>

            <button
              onClick={() => remove(c.id)}
              disabled={deleting === c.id}
              title="Usuń rozmowę"
              className="history-delete"
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                background: "transparent",
                border: "1px solid #a33",
                borderRadius: 8,
                color: "#f07070",
                padding: "4px 10px",
                fontSize: 13,
                cursor: deleting === c.id ? "wait" : "pointer",
              }}
            >
              🗑️ {deleting === c.id ? "..." : "Usuń"}
            </button>
          </div>
        ))}
      </div>

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1a1a2a",
            border: "1px solid #61F8F8",
            borderRadius: 10,
            color: "#ededed",
            padding: "10px 18px",
            fontSize: 14,
            zIndex: 60,
          }}
        >
          {toast}
        </div>
      )}

      <style>{`
        .history-card:hover {
          background: #20203a;
          border-color: #61F8F8;
        }
      `}</style>
    </div>
  );
}
