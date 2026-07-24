"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/lib/auth";
import type { KnowledgeHit } from "@/app/lib/knowledge";

// Podgląd bazy wiedzy — co dokładnie widzi agent, gdy sięga po searchKnowledge.
// Wyszukiwarka odpala TEN SAM silnik co agent, tylko bez modelu w środku:
// wpisujesz pytanie i widzisz surowe fragmenty z ich podobieństwem. Dzięki temu
// da się odróżnić "RAG nie działa" od "model źle użył tego, co dostał".

// Dokument widziany "z lotu ptaka" — w bazie leży pokrojony na fragmenty,
// ale użytkownik wrzucał jeden plik i chce go widzieć jako jedną pozycję.
type DocumentCard = {
  title: string;
  chunks: number;
  createdAt: string;
};

type Chunk = {
  id: string;
  content: string;
  chunkIndex: number;
};

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; query: string; results: KnowledgeHit[]; agentThreshold: number }
  | { kind: "error"; message: string };

type ChunkRow = {
  id: string;
  content: string;
  metadata: { chunk_index?: number } | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  return n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
}

export default function KnowledgePage() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<DocumentCard[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Record<string, Chunk[]>>({});
  const [loadingChunks, setLoadingChunks] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });

  const totalChunks = docs.reduce((sum, doc) => sum + doc.chunks, 0);

  // Lista dokumentów: jeden dokument = wiele wierszy (fragmentów),
  // więc grupujemy po tytule i liczymy fragmenty.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("title, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (cancelled) return;

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
          // Lista jest posortowana malejąco — trzymamy najstarszy wpis
          // jako datę dodania dokumentu.
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
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const loadChunks = useCallback(
    async (title: string) => {
      if (chunks[title]) return; // raz pobrane zostaje w pamięci
      if (!user) return;

      setLoadingChunks(title);
      const { data, error } = await supabase
        .from("documents")
        .select("id, content, metadata")
        .eq("title", title)
        .eq("user_id", user.id);
      setLoadingChunks(null);

      if (error) {
        console.error("Supabase: nie udało się pobrać fragmentów.", error);
        return;
      }

      // Sortujemy po chunk_index po stronie klienta — kolejność fragmentów to
      // kolejność w dokumencie, a nie kolejność wierszy w bazie.
      const list: Chunk[] = ((data ?? []) as ChunkRow[])
        .map((row) => ({
          id: row.id,
          content: row.content,
          chunkIndex: row.metadata?.chunk_index ?? 0,
        }))
        .sort((a, b) => a.chunkIndex - b.chunkIndex);

      setChunks((prev) => ({ ...prev, [title]: list }));
    },
    [chunks, user],
  );

  function toggleDoc(title: string) {
    if (expanded === title) {
      setExpanded(null);
      return;
    }
    setExpanded(title);
    void loadChunks(title);
  }

  // Wejście z cytatu w czacie: /knowledge?doc=Cennik%202026 — od razu rozwijamy
  // wskazany dokument, żeby dało się sprawdzić odpowiedź agenta u źródła.
  useEffect(() => {
    if (loadingDocs || docs.length === 0) return;

    const wanted = new URLSearchParams(window.location.search).get("doc");
    if (!wanted || !docs.some((doc) => doc.title === wanted)) return;

    setExpanded(wanted);
    void loadChunks(wanted);
    // Celowo bez loadChunks w zależnościach — ma się wykonać raz, po wczytaniu
    // listy dokumentów, a nie przy każdej zmianie cache'u fragmentów.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingDocs, docs]);

  async function runSearch() {
    const q = query.trim();
    if (!q || search.kind === "loading") return;

    setSearch({ kind: "loading" });
    try {
      const res = await fetch("/api/knowledge-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, userId: user?.id }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data?.error ?? "Wyszukiwanie nie powiodło się.");

      setSearch({
        kind: "done",
        query: q,
        results: data.results ?? [],
        agentThreshold: data.agent_threshold ?? 0.5,
      });
    } catch (err) {
      setSearch({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 16px 48px" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>
          🔍 Podgląd bazy wiedzy
        </h1>
        <p style={{ color: "#888", marginTop: 6, fontSize: 14 }}>
          Sprawdź, co agent naprawdę znajduje — zanim go o to zapytasz.
        </p>
      </header>

      {/* ── Wyszukiwarka (test RAG bez agenta) ────────────────────── */}
      <div
        style={{
          border: "1px solid #2a2a2a",
          borderRadius: 12,
          padding: 16,
          marginBottom: 28,
        }}
      >
        <label
          style={{ display: "block", fontSize: 13, color: "#aaa", marginBottom: 6 }}
        >
          Szukaj w bazie wiedzy
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
            }}
            placeholder="Np. VIP, ile kosztuje Premium, warunki rezygnacji…"
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #333",
              background: "#111",
              color: "inherit",
              fontSize: 14,
            }}
          />
          <button
            onClick={() => void runSearch()}
            disabled={!query.trim() || search.kind === "loading"}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "none",
              background: !query.trim() || search.kind === "loading" ? "#333" : "#2563eb",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor:
                !query.trim() || search.kind === "loading" ? "not-allowed" : "pointer",
              flexShrink: 0,
            }}
          >
            {search.kind === "loading" ? "Szukam…" : "Szukaj"}
          </button>
        </div>

        <p style={{ color: "#666", fontSize: 12, margin: "8px 0 0" }}>
          To czyste wyszukiwanie wektorowe — bez modelu. Agent widzi tylko
          fragmenty z podobieństwem powyżej progu.
        </p>

        {search.kind === "error" && (
          <div style={{ marginTop: 14, fontSize: 14, color: "#ef4444" }}>
            ❌ {search.message}
          </div>
        )}

        {search.kind === "done" && (
          <div style={{ marginTop: 16 }}>
            {search.results.length === 0 ? (
              <div style={{ fontSize: 14, color: "#888" }}>
                Brak jakichkolwiek trafień dla „{search.query}”. Agent odmówi
                odpowiedzi na to pytanie.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: "#aaa", marginBottom: 10 }}>
                  {search.results.filter((r) => r.similarity >= search.agentThreshold).length}{" "}
                  z {search.results.length} fragmentów przekracza próg{" "}
                  {search.agentThreshold} — tylko te trafią do agenta.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {search.results.map((hit, i) => {
                    const visible = hit.similarity >= search.agentThreshold;
                    return (
                      <div
                        key={`${hit.title}-${i}`}
                        style={{
                          border: `1px solid ${visible ? "#1f3a2a" : "#2a2a2a"}`,
                          borderRadius: 10,
                          padding: "10px 12px",
                          opacity: visible ? 1 : 0.55,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 10,
                            marginBottom: 6,
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 600 }}>
                            📄 {hit.title}
                            {typeof hit.metadata?.chunk_index === "number" && (
                              <span style={{ color: "#666", fontWeight: 400 }}>
                                {" "}
                                · fragment {hit.metadata.chunk_index + 1}
                                {hit.metadata.total_chunks
                                  ? `/${hit.metadata.total_chunks}`
                                  : ""}
                              </span>
                            )}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: visible ? "#22c55e" : "#777",
                              flexShrink: 0,
                            }}
                          >
                            {hit.similarity.toFixed(2)}
                            {!visible && " · poniżej progu"}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: "#bbb",
                            lineHeight: 1.5,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {hit.content}
                        </div>
                        {hit.added_at && (
                          <div style={{ fontSize: 11, color: "#666", marginTop: 6 }}>
                            dodano: {hit.added_at}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Lista dokumentów ──────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Twoja baza wiedzy</h2>
        <Link href="/upload" style={{ fontSize: 13, color: "#3b82f6" }}>
          📤 Dodaj dokument
        </Link>
      </div>

      {loadingDocs ? (
        <div style={{ color: "#666", fontSize: 14 }}>Wczytuję…</div>
      ) : docs.length === 0 ? (
        <div style={{ color: "#666", fontSize: 14 }}>
          Baza jest pusta. <Link href="/upload">Wklej pierwszy dokument</Link> — bez
          tego agent odmówi odpowiedzi na pytania o firmę.
        </div>
      ) : (
        <>
          <div style={{ color: "#888", fontSize: 13, marginBottom: 12 }}>
            {totalChunks} {plural(totalChunks, "fragment", "fragmenty", "fragmentów")} z{" "}
            {docs.length} {plural(docs.length, "dokumentu", "dokumentów", "dokumentów")}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {docs.map((doc) => {
              const open = expanded === doc.title;
              const docChunks = chunks[doc.title];

              return (
                <div
                  key={doc.title}
                  style={{
                    border: `1px solid ${open ? "#2563eb" : "#2a2a2a"}`,
                    borderRadius: 10,
                    overflow: "hidden",
                  }}
                >
                  <button
                    onClick={() => toggleDoc(doc.title)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "12px 14px",
                      background: "transparent",
                      border: "none",
                      color: "inherit",
                      cursor: "pointer",
                      textAlign: "left",
                      font: "inherit",
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>
                        📄 {doc.title}
                      </span>
                      <span
                        style={{
                          display: "block",
                          color: "#777",
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        {doc.chunks}{" "}
                        {plural(doc.chunks, "fragment", "fragmenty", "fragmentów")} ·{" "}
                        {formatDate(doc.createdAt)}
                      </span>
                    </span>
                    <span style={{ color: "#777", fontSize: 12, flexShrink: 0 }}>
                      {open ? "▲ zwiń" : "▼ podgląd"}
                    </span>
                  </button>

                  {open && (
                    <div style={{ padding: "0 14px 14px" }}>
                      {loadingChunks === doc.title || !docChunks ? (
                        <div style={{ color: "#666", fontSize: 13 }}>
                          Wczytuję fragmenty…
                        </div>
                      ) : (
                        <div
                          style={{ display: "flex", flexDirection: "column", gap: 8 }}
                        >
                          {docChunks.map((chunk) => (
                            <div
                              key={chunk.id}
                              style={{
                                border: "1px solid #222",
                                borderRadius: 8,
                                padding: "8px 10px",
                                background: "#111",
                              }}
                            >
                              <div
                                style={{ fontSize: 11, color: "#666", marginBottom: 4 }}
                              >
                                fragment {chunk.chunkIndex + 1} z {doc.chunks}
                              </div>
                              <div
                                style={{
                                  fontSize: 13,
                                  color: "#bbb",
                                  lineHeight: 1.5,
                                  whiteSpace: "pre-wrap",
                                }}
                              >
                                {chunk.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
