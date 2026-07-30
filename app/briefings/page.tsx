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

// Data utworzenia w ładnym polskim formacie: "wtorek, 28 lipca 2026 19:32".
function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(d);
  const time = new Intl.DateTimeFormat("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Warsaw",
  }).format(d);
  return `${date} ${time}`;
}

// Krótki podgląd na kartę — usuwamy znaczniki markdown i bierzemy ~150 znaków.
function preview(content: string): string {
  const plain = content
    .replace(/^#+\s*/gm, "") // nagłówki
    .replace(/[*_`>#-]/g, "") // pozostałe znaki markdown
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 150 ? plain.slice(0, 150) + "…" : plain;
}

export default function BriefingsPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Briefing | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

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
        <div className="br-list">
          {briefings.map((b) => (
            <button key={b.id} className="br-card" onClick={() => setOpen(b)}>
              <div className="br-card-date">{formatCreatedAt(b.created_at)}</div>
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
      )}

      {/* Podgląd pełnego briefingu — renderowany markdown, jak na dashboardzie. */}
      {open && (
        <div className="br-modal-bg" onClick={() => setOpen(null)}>
          <div
            className="br-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Podgląd briefingu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="br-modal-head">
              <div className="br-modal-badge">PORANNY BRIEFING</div>
              <div className="br-modal-actions">
                <button
                  className="br-chip"
                  onClick={() => copyContent(open.content)}
                >
                  {copied ? "✓ Skopiowano" : "📋 Kopiuj"}
                </button>
                <button
                  className="br-chip"
                  onClick={() => setOpen(null)}
                  aria-label="Zamknij"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="br-modal-date">{formatCreatedAt(open.created_at)}</div>
            <div className="markdown br-modal-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {open.content}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .br-wrap {
          max-width: 820px;
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
          color: #8a8a9a;
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
          background: #2a1a1a;
          border: 1px solid #5a2a2a;
          color: #f0a0a0;
          padding: 12px 14px;
          border-radius: 10px;
          margin-bottom: 16px;
          font-size: 14px;
        }
        .br-muted {
          color: #8a8a9a;
          padding: 24px 0;
        }
        .br-empty {
          text-align: center;
          color: #8a8a9a;
          padding: 48px 16px;
          border: 1px dashed #2a2a3a;
          border-radius: 14px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .br-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .br-card {
          text-align: left;
          background: #14141c;
          border: 1px solid #23233a;
          border-radius: 14px;
          padding: 16px 18px;
          cursor: pointer;
          transition: border-color 0.15s, transform 0.15s;
          font: inherit;
          color: inherit;
        }
        .br-card:hover {
          border-color: #5b6cff;
          transform: translateY(-1px);
        }
        .br-card-date {
          font-weight: 600;
          font-size: 15px;
          margin-bottom: 6px;
        }
        /* Tylko pierwsza litera z wielkiej — "capitalize" podniosłoby też nazwę
           miesiąca ("30 Lipca"), a po polsku miesiące piszemy z małej. */
        .br-card-date::first-letter {
          text-transform: uppercase;
        }
        .br-card-preview {
          color: #b5b5c5;
          font-size: 14px;
          line-height: 1.5;
          margin-bottom: 10px;
        }
        .br-card-status {
          font-size: 12px;
          color: #6ecf9a;
        }
        /* Ręczny briefing na niebiesko — w kolorze przycisku, który go stworzył. */
        .br-card-status.br-manual {
          color: #8b9aff;
        }
        .br-modal-bg {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 40px 16px;
          overflow-y: auto;
          z-index: 50;
        }
        .br-modal {
          background: #0f0f18;
          border: 1px solid #23233a;
          border-radius: 18px;
          padding: 24px 26px 28px;
          max-width: 680px;
          width: 100%;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }
        .br-modal-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .br-modal-badge {
          font-size: 12px;
          letter-spacing: 0.12em;
          font-weight: 700;
          color: #7b8cff;
        }
        .br-modal-actions {
          display: flex;
          gap: 8px;
        }
        .br-modal-date {
          color: #8a8a9a;
          font-size: 13px;
          margin: 4px 0 8px;
        }
        .br-modal-date::first-letter {
          text-transform: uppercase;
        }
        .br-chip {
          background: #1a1a26;
          border: 1px solid #2c2c42;
          color: #c5c5d5;
          border-radius: 8px;
          padding: 6px 12px;
          font-size: 13px;
          cursor: pointer;
          font: inherit;
        }
        .br-chip:hover {
          border-color: #5b6cff;
        }
        .br-modal-body {
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}
