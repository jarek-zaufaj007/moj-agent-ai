"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/lib/auth";

// Dokument widziany "z lotu ptaka" — w bazie leży pokrojony na fragmenty,
// ale użytkownik wrzucał jeden plik i chce go widzieć jako jedną pozycję.
type DocumentCard = {
  title: string;
  chunks: number;
  createdAt: string;
};

type Status =
  | { kind: "idle" }
  | { kind: "working"; current: number; total: number }
  | { kind: "done"; chunks: number }
  | { kind: "error"; message: string };

const EXAMPLES = [
  {
    label: "Cennik",
    hint: "Pakiet Basic: 99 zł/mies. Pakiet Premium: 299 zł/mies…",
  },
  {
    label: "FAQ",
    hint: "Q: Jak mogę anulować subskrypcję? A: Wyślij email na…",
  },
  {
    label: "Regulamin",
    hint: "§1. Postanowienia ogólne. 1.1 Niniejszy regulamin…",
  },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function UploadPage() {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [docs, setDocs] = useState<DocumentCard[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const isWorking = status.kind === "working";

  // Lista dokumentów: w bazie jeden dokument = wiele wierszy (fragmentów),
  // więc grupujemy po tytule i liczymy fragmenty.
  const loadDocs = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("documents")
      .select("title, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase: nie udało się pobrać dokumentów.", error);
      setLoadingDocs(false);
      return;
    }

    const byTitle = new Map<string, DocumentCard>();
    for (const row of data ?? []) {
      const existing = byTitle.get(row.title);
      if (existing) {
        existing.chunks++;
        // Lista jest posortowana malejąco — trzymamy najstarszy wpis jako datę dodania.
        if (row.created_at < existing.createdAt) existing.createdAt = row.created_at;
      } else {
        byTitle.set(row.title, {
          title: row.title,
          chunks: 1,
          createdAt: row.created_at,
        });
      }
    }

    setDocs([...byTitle.values()]);
    setLoadingDocs(false);
  }, [user]);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  async function save() {
    if (!title.trim() || !content.trim() || isWorking || !user) return;

    setStatus({ kind: "working", current: 0, total: 0 });

    try {
      const res = await fetch("/api/upload-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // userId → serwer zapisze fragmenty z user_id (dokument należy do konta).
        body: JSON.stringify({ title, content, userId: user.id }),
      });

      if (!res.ok || !res.body) {
        const { error } = await res.json().catch(() => ({ error: null }));
        throw new Error(error ?? "Serwer odrzucił dokument.");
      }

      // Odpowiedź to strumień linii JSON (NDJSON) — czytamy je na bieżąco,
      // żeby pasek postępu ruszał z każdym zapisanym fragmentem.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // ostatnia linia bywa ucięta w połowie

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);

          if (event.type === "start") {
            setStatus({ kind: "working", current: 0, total: event.total });
          } else if (event.type === "progress") {
            setStatus({ kind: "working", current: event.current, total: event.total });
          } else if (event.type === "done") {
            setStatus({ kind: "done", chunks: event.chunks_saved });
            setTitle("");
            setContent("");
            void loadDocs();
          } else if (event.type === "error") {
            setStatus({ kind: "error", message: event.error });
          }
        }
      }
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function remove(docTitle: string) {
    const ok = window.confirm(
      `Usunąć dokument "${docTitle}" ze wszystkimi fragmentami? Tej operacji nie można cofnąć.`,
    );
    if (!ok) return;

    setDeleting(docTitle);
    // Filtr user_id: usuwamy tylko własny dokument.
    const del = supabase.from("documents").delete().eq("title", docTitle);
    const { error } = user ? await del.eq("user_id", user.id) : await del;
    setDeleting(null);

    if (error) {
      console.error("Supabase: nie udało się usunąć dokumentu.", error);
      return;
    }
    setDocs((prev) => prev.filter((d) => d.title !== docTitle));
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 16px 48px" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>📚 Baza wiedzy</h1>
        <p style={{ color: "#888", marginTop: 6, fontSize: 14 }}>
          Wklej tekst — agent będzie z niego korzystał
        </p>
      </header>

      {/* ── Formularz ─────────────────────────────────────────────── */}
      <div
        style={{
          border: "1px solid #2a2a2a",
          borderRadius: 12,
          padding: 16,
          marginBottom: 28,
        }}
      >
        <label style={{ display: "block", fontSize: 13, color: "#aaa", marginBottom: 6 }}>
          Tytuł dokumentu
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isWorking}
          placeholder="Np. Cennik 2026, FAQ, Regulamin firmy"
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #333",
            background: "#111",
            color: "inherit",
            fontSize: 14,
            marginBottom: 16,
          }}
        />

        <label style={{ display: "block", fontSize: 13, color: "#aaa", marginBottom: 6 }}>
          Treść dokumentu
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={isWorking}
          placeholder="Wklej tutaj treść dokumentu…"
          style={{
            width: "100%",
            minHeight: 300,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #333",
            background: "#111",
            color: "inherit",
            fontSize: 14,
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 16px" }}>
          {EXAMPLES.map((ex) => (
            <span
              key={ex.label}
              title={ex.hint}
              style={{
                fontSize: 12,
                color: "#777",
                border: "1px solid #2a2a2a",
                borderRadius: 999,
                padding: "3px 10px",
              }}
            >
              {ex.label}: {ex.hint.slice(0, 34)}…
            </span>
          ))}
        </div>

        <button
          onClick={save}
          disabled={isWorking || !title.trim() || !content.trim()}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            background: isWorking || !title.trim() || !content.trim() ? "#333" : "#2563eb",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor:
              isWorking || !title.trim() || !content.trim() ? "not-allowed" : "pointer",
          }}
        >
          📤 Zapisz w bazie wiedzy
        </button>

        {/* ── Postęp / wynik ──────────────────────────────────────── */}
        {isWorking && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, color: "#aaa", marginBottom: 6 }}>
              {status.total === 0
                ? "Dzielę tekst na fragmenty…"
                : `Przetwarzam fragment ${status.current} z ${status.total}…`}
            </div>
            <div
              style={{
                height: 8,
                background: "#222",
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: status.total ? `${(status.current / status.total) * 100}%` : "0%",
                  background: "#2563eb",
                  transition: "width 200ms",
                }}
              />
            </div>
          </div>
        )}

        {status.kind === "done" && (
          <div style={{ marginTop: 16, fontSize: 14, color: "#22c55e" }}>
            ✅ Zapisano {status.chunks}{" "}
            {status.chunks === 1 ? "fragment" : status.chunks < 5 ? "fragmenty" : "fragmentów"}!
          </div>
        )}

        {status.kind === "error" && (
          <div style={{ marginTop: 16, fontSize: 14, color: "#ef4444" }}>
            ❌ {status.message}
          </div>
        )}
      </div>

      {/* ── Lista zapisanych dokumentów ───────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
          Zapisane dokumenty
        </h2>
        <Link href="/knowledge" style={{ fontSize: 13, color: "#3b82f6" }}>
          🔍 Podgląd i test wyszukiwania
        </Link>
      </div>

      {loadingDocs ? (
        <div style={{ color: "#666", fontSize: 14 }}>Wczytuję…</div>
      ) : docs.length === 0 ? (
        <div style={{ color: "#666", fontSize: 14 }}>
          Brak dokumentów. Wklej pierwszy tekst powyżej.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {docs.map((doc) => (
            <div
              key={doc.title}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                border: "1px solid #2a2a2a",
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.title}</div>
                <div style={{ color: "#777", fontSize: 12, marginTop: 2 }}>
                  {doc.chunks} {doc.chunks === 1 ? "fragment" : "fragmentów"} ·{" "}
                  {formatDate(doc.createdAt)}
                </div>
              </div>
              <button
                onClick={() => remove(doc.title)}
                disabled={deleting === doc.title}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid #3a2a2a",
                  background: "transparent",
                  color: "#ef4444",
                  fontSize: 13,
                  cursor: deleting === doc.title ? "not-allowed" : "pointer",
                  flexShrink: 0,
                }}
              >
                {deleting === doc.title ? "Usuwam…" : "🗑️ Usuń"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
