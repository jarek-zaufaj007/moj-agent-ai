"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/lib/supabase";

// ── Typ rekordu briefingu (tabela briefings, patrz L09_W1_briefings.sql) ─────
type Briefing = {
  id: string;
  content: string;
  date: string;
  created_at: string;
  // 'cron' = automat o 7:00, 'manual' = przycisk "Wygeneruj teraz".
  // Wiersze sprzed migracji L09_W4 dostają 'cron' z defaultu kolumny.
  source: "cron" | "manual";
};

// Nagłówek karty i panelu: "28 lipca 2026, wtorek".
function formatDateLabel(iso: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
    timeZone: "Europe/Warsaw",
  })
    .format(new Date(iso))
    // Intl daje "wtorek, 28 lipca 2026" — przestawiamy, żeby data była pierwsza.
    .split(", ")
    .reverse()
    .join(", ");
}

// Drobny podpis w panelu: "28.07.2026, 19:54".
function formatGenerated(iso: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  }).format(new Date(iso));
}

// Krótki podgląd na kartę — usuwamy znaczniki markdown i bierzemy ~110 znaków
// (węższa kolumna niż w poprzednim układzie jednokolumnowym).
function preview(content: string): string {
  const plain = content
    .replace(/^#+\s*/gm, "") // nagłówki
    .replace(/[*_`>#-]/g, "") // pozostałe znaki markdown
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 110 ? plain.slice(0, 110) + "…" : plain;
}

export default function BriefingsPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Wybrana pozycja listy. null = "nic nie kliknięto", wtedy pokazujemy
  // najnowszy briefing — strona nigdy nie startuje z pustym panelem.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected =
    briefings.find((b) => b.id === selectedId) ?? briefings[0] ?? null;

  // Pobierz 30 najnowszych briefingów (RLS: polityka "briefings public read").
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("briefings")
      .select("id, content, date, created_at, source")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      setError(
        error.code === "PGRST205"
          ? "Tabela 'briefings' nie istnieje — uruchom migrację supabase/L09_W1_briefings.sql."
          : error.code === "42703"
            ? "Brak kolumny 'source' — uruchom migrację supabase/L09_W4_briefings_source.sql."
            : "Nie udało się wczytać briefingów.",
      );
    } else {
      setError(null);
      setBriefings(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // "Wygeneruj teraz" NIE woła /api/cron/morning — tamten endpoint wymaga
  // nagłówka Authorization: Bearer $CRON_SECRET (L09 W2), a sekretu nie wolno
  // wysyłać do przeglądarki. Wołamy /api/briefings/generate, który po stronie
  // serwera odpala tę samą logikę (app/lib/briefing.ts) bez sekretu.
  async function generateNow() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/briefings/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error ?? "Nie udało się wygenerować briefingu.");
      } else {
        await load(); // odśwież listę — nowy briefing wskoczy na górę
        setSelectedId(null); // …i od razu pokaż go w panelu (fallback = [0])
      }
    } catch {
      setError("Nie udało się połączyć z serwerem.");
    }
    setGenerating(false);
  }

  async function copyContent(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* schowek może być niedostępny — ignorujemy */
    }
  }

  return (
    <div className="br-wrap">
      <div className="br-head">
        <div>
          <h1 className="br-title">📰 Briefingi</h1>
          <p className="br-subtitle">
            Automatyczne podsumowania dnia od Twojego agenta
          </p>
        </div>
        <button
          className="br-generate"
          onClick={generateNow}
          disabled={generating}
        >
          {generating ? "⏳ Generuję…" : "🔄 Wygeneruj teraz"}
        </button>
      </div>

      {error && <div className="br-error">⚠️ {error}</div>}

      {loading ? (
        <div className="br-muted">Wczytuję briefingi…</div>
      ) : briefings.length === 0 ? (
        <div className="br-empty">
          <div style={{ fontSize: 40 }}>🌙</div>
          <p>Brak briefingów. Cron job wygeneruje pierwszy jutro rano!</p>
          <button
            className="br-generate"
            onClick={generateNow}
            disabled={generating}
          >
            {generating ? "⏳ Generuję…" : "🔄 Wygeneruj teraz"}
          </button>
        </div>
      ) : (
        // Układ master-detail: lista po lewej, treść wybranego po prawej.
        // Na wąskim ekranie kolumny składają się jedna pod drugą (media query).
        <div className="br-split">
          <aside className="br-side">
            <div className="br-side-head">
              <span>Twoje briefingi</span>
              <span className="br-count">{briefings.length}</span>
            </div>
            <div className="br-list">
              {briefings.map((b) => (
                <button
                  key={b.id}
                  className={
                    b.id === selected?.id ? "br-card br-card-active" : "br-card"
                  }
                  aria-current={b.id === selected?.id}
                  onClick={() => setSelectedId(b.id)}
                >
                  <div className="br-card-date">
                    {formatDateLabel(b.created_at)}
                  </div>
                  <div className="br-card-preview">{preview(b.content)}</div>
                  <div
                    className={
                      b.source === "manual"
                        ? "br-card-status br-manual"
                        : "br-card-status"
                    }
                  >
                    {b.source === "manual"
                      ? "👆 wygenerowany ręcznie"
                      : "✅ automatycznie (cron)"}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          {/* Panel treści — renderowany markdown, jak na dashboardzie. */}
          <section className="br-detail">
            {selected && (
              <>
                <div className="br-detail-head">
                  <div>
                    <div className="br-detail-date">
                      {formatDateLabel(selected.created_at)}
                    </div>
                    <div className="br-detail-meta">
                      Wygenerowano {formatGenerated(selected.created_at)}
                      {selected.source === "manual" ? " (ręcznie)" : " (cron)"}
                    </div>
                  </div>
                  <button
                    className="br-chip"
                    onClick={() => copyContent(selected.content)}
                  >
                    {copied ? "✓ Skopiowano" : "📋 Kopiuj"}
                  </button>
                </div>
                <div className="markdown br-detail-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selected.content}
                  </ReactMarkdown>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <style jsx>{`
        .br-wrap {
          max-width: 1180px;
          margin: 0 auto;
          padding: 8px 4px 40px;
        }
        .br-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        .br-title {
          font-size: 28px;
          font-weight: 700;
          margin: 0 0 4px;
        }
        .br-subtitle {
          margin: 0;
          color: var(--muted);
          font-size: 14px;
        }
        .br-generate {
          background: #5b6cff;
          border: none;
          color: #fff;
          border-radius: 10px;
          padding: 10px 16px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }
        .br-generate:hover:not(:disabled) {
          background: #4a5aee;
        }
        .br-generate:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .br-error {
          background: var(--danger-bg);
          border: 1px solid var(--danger-border);
          color: var(--danger-text);
          padding: 12px 14px;
          border-radius: 10px;
          margin-bottom: 16px;
          font-size: 14px;
        }
        .br-muted {
          color: var(--muted);
          padding: 24px 0;
        }
        .br-empty {
          text-align: center;
          color: var(--muted);
          padding: 48px 16px;
          border: 1px dashed var(--surface-2);
          border-radius: 14px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        /* 340px na listę, reszta na treść. */
        .br-split {
          display: grid;
          grid-template-columns: 340px minmax(0, 1fr);
          gap: 20px;
          align-items: start;
        }
        .br-side {
          /* Lista jedzie z ekranem, żeby przy długim briefingu dało się
             przeskoczyć na inny dzień bez scrollowania w górę. */
          position: sticky;
          top: 16px;
          max-height: calc(100vh - 48px);
          display: flex;
          flex-direction: column;
        }
        .br-side-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 14px;
          font-weight: 600;
          color: var(--muted-strong);
          padding: 0 4px 10px;
        }
        .br-count {
          background: var(--surface);
          border: 1px solid var(--surface-2);
          border-radius: 999px;
          min-width: 24px;
          padding: 2px 8px;
          text-align: center;
          font-size: 12px;
          color: var(--muted);
        }
        .br-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow-y: auto;
          padding-right: 4px;
        }
        .br-card {
          text-align: left;
          background: var(--surface-3);
          border: 1px solid var(--surface-2);
          border-radius: 14px;
          padding: 14px 16px;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
          font: inherit;
          color: inherit;
        }
        .br-card:hover {
          border-color: var(--border-2);
        }
        .br-card-active {
          border-color: #5b6cff;
          background: var(--surface-2);
        }
        .br-card-date {
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 6px;
        }
        /* Tylko pierwsza litera z wielkiej — "capitalize" podniosłoby też nazwę
           miesiąca ("30 Lipca"), a po polsku miesiące piszemy z małej. */
        .br-card-date::first-letter {
          text-transform: uppercase;
        }
        .br-card-preview {
          color: var(--muted-strong);
          font-size: 13px;
          line-height: 1.5;
          margin-bottom: 8px;
        }
        .br-card-status {
          font-size: 12px;
          color: var(--ok-text);
        }
        /* Ręczny briefing na niebiesko — w kolorze przycisku, który go stworzył. */
        .br-card-status.br-manual {
          color: #8b9aff;
        }
        .br-detail {
          background: var(--bg-elev);
          border: 1px solid var(--surface-2);
          border-radius: 18px;
          padding: 22px 26px 28px;
          min-width: 0; /* bez tego długi kod/tabela rozpycha grid */
        }
        .br-detail-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          border-bottom: 1px solid var(--border-soft);
          padding-bottom: 14px;
          margin-bottom: 6px;
        }
        .br-detail-date {
          font-weight: 600;
          font-size: 15px;
        }
        .br-detail-date::first-letter {
          text-transform: uppercase;
        }
        .br-detail-meta {
          color: var(--muted);
          font-size: 12px;
          margin-top: 3px;
        }
        .br-chip {
          background: var(--surface);
          border: 1px solid var(--surface-2);
          color: var(--muted-strong);
          border-radius: 8px;
          padding: 6px 12px;
          font-size: 13px;
          cursor: pointer;
          font: inherit;
          white-space: nowrap;
        }
        .br-chip:hover {
          border-color: #5b6cff;
        }
        .br-detail-body {
          margin-top: 8px;
        }

        /* Wąski ekran: kolumny jedna pod drugą, lista przestaje być sticky
           (inaczej przykleiłaby się nad treścią i zjadła pół ekranu). */
        @media (max-width: 900px) {
          .br-split {
            grid-template-columns: 1fr;
          }
          .br-side {
            position: static;
            max-height: none;
          }
          .br-list {
            overflow-y: visible;
          }
        }
      `}</style>
    </div>
  );
}
