"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Panel bezpieczeństwa (Lekcja 10, Warsztat 4).
//
// Strona sama NIE czyta bazy: message_logs i api_usage mają RLS bez polityk,
// więc anon key i tak nic by nie zobaczył. Wszystko leci przez
// /api/admin/security, który sprawdza token sesji i czyta dane kluczem
// service_role. Tu zostaje samo rysowanie.

type Blocked = {
  id: string;
  createdAt: string;
  who: string;
  reason: string;
  excerpt: string;
  length: number;
};

type TopUser = {
  userId: string;
  who: string;
  today: number;
  week: number;
  calls: number;
  percent: number;
};

type Alert = {
  level: "red" | "amber";
  icon: string;
  title: string;
  detail: string;
  when: string | null;
};

type Stats = {
  tokensToday: number;
  tokensWeek: number;
  blockedCount: number;
  blockedToday: number;
  blockedTruncated: boolean;
  activeUsers: number;
  activeUsers24h: number;
  avgPerUser: number;
  messages24h: number;
  dailyLimit: number;
};

type Payload = {
  ok: boolean;
  blocked: Blocked[];
  top: TopUser[];
  alerts: Alert[];
  stats: Stats;
  warnings: string[];
  error?: string;
};

const num = (n: number) => n.toLocaleString("pl-PL");

// Polski ma trzy formy liczby mnogiej: 1 użytkownik, 2–4 użytkownicy,
// 5+ użytkowników. Wyjątek to nastki (12–14), które mimo końcówki 2–4 biorą
// formę "wielu" — stąd warunek na resztę z dzielenia przez 100.
function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function when(iso: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  }).format(new Date(iso));
}

export default function SecurityPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Token sesji w nagłówku — endpoint weryfikuje go po stronie serwera.
      // Samo user_id w body nie byłoby żadnym dowodem tożsamości.
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) {
        setError("Brak sesji — zaloguj się ponownie.");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/admin/security", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json: Payload = await res.json();

      if (!res.ok || !json.ok) {
        setError(json.error ?? "Nie udało się wczytać danych panelu.");
      } else {
        setError(null);
        setData(json);
      }
    } catch {
      setError("Nie udało się połączyć z serwerem.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="sec-wrap">
      <div className="sec-head">
        <div>
          <h1 className="sec-title">🛡️ Panel bezpieczeństwa</h1>
          <p className="sec-sub">
            Kto próbuje złamać agenta i ile kosztuje Cię każdy użytkownik
          </p>
        </div>
        <button className="sec-refresh" onClick={load} disabled={loading}>
          {loading ? "⏳ Wczytuję…" : "🔄 Odśwież"}
        </button>
      </div>

      {error && <div className="sec-error">⚠️ {error}</div>}
      {data?.warnings.map((w) => (
        <div key={w} className="sec-warn">
          ⚙️ {w}
        </div>
      ))}

      {loading && !data ? (
        <div className="sec-muted">Zbieram dane…</div>
      ) : data ? (
        <>
          {/* ── 4. Statystyki — na górze, bo to pierwszy rzut oka ───────── */}
          <div className="sec-tiles">
            <Tile
              label="Tokeny dziś"
              value={num(data.stats.tokensToday)}
              note={`limit ${num(data.stats.dailyLimit)} / user`}
            />
            <Tile
              label="Tokeny (7 dni)"
              value={num(data.stats.tokensWeek)}
              note={`śr. ${num(data.stats.avgPerUser)} / user`}
            />
            <Tile
              label="Zablokowane"
              value={num(data.stats.blockedCount)}
              note={`${data.stats.blockedToday} dziś`}
              tone={data.stats.blockedCount > 0 ? "red" : undefined}
            />
            <Tile
              label="Wiadomości (24 h)"
              value={num(data.stats.messages24h)}
              note={`${data.stats.activeUsers24h} ${plural(
                data.stats.activeUsers24h,
                "aktywny użytkownik",
                "aktywni użytkownicy",
                "aktywnych użytkowników",
              )}`}
            />
          </div>

          {/* ── 3. Alerty ──────────────────────────────────────────────── */}
          <section className="sec-block">
            <h2 className="sec-h2">🔴 Alerty</h2>
            {data.alerts.length === 0 ? (
              <div className="sec-ok">✅ Cicho — żadnych podejrzanych zachowań.</div>
            ) : (
              <div className="sec-alerts">
                {data.alerts.map((a, i) => (
                  <div key={i} className={`sec-alert ${a.level}`}>
                    <span className="sec-alert-icon">{a.icon}</span>
                    <div>
                      <div className="sec-alert-title">{a.title}</div>
                      <div className="sec-alert-detail">{a.detail}</div>
                    </div>
                    {a.when && <span className="sec-alert-when">{when(a.when)}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── 2. Top 5 użytkowników ──────────────────────────────────── */}
          <section className="sec-block">
            <h2 className="sec-h2">📊 Top 5 użytkowników po zużyciu</h2>
            {data.top.length === 0 ? (
              <div className="sec-muted">Brak zapisanego zużycia w ostatnich 7 dniach.</div>
            ) : (
              <div className="sec-table">
                <div className="sec-row sec-row-head">
                  <span>Użytkownik</span>
                  <span className="sec-num">Dziś</span>
                  <span className="sec-num">7 dni</span>
                  <span className="sec-num">Wywołań</span>
                  <span>% limitu</span>
                </div>
                {data.top.map((u) => (
                  <div key={u.userId} className="sec-row">
                    <span className="sec-who" title={u.who}>
                      {u.who}
                    </span>
                    <span className="sec-num">{num(u.today)}</span>
                    <span className="sec-num">{num(u.week)}</span>
                    <span className="sec-num">{num(u.calls)}</span>
                    <span className="sec-bar-cell">
                      <span className="sec-bar">
                        <span
                          className={
                            u.percent >= 100
                              ? "sec-fill over"
                              : u.percent >= 80
                                ? "sec-fill warn"
                                : "sec-fill"
                          }
                          // Pasek nie może wyjść poza tor przy 130% limitu.
                          style={{ width: `${Math.min(100, u.percent)}%` }}
                        />
                      </span>
                      <span className="sec-pct">{u.percent}%</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── 1. Zablokowane wiadomości ──────────────────────────────── */}
          <section className="sec-block">
            <h2 className="sec-h2">
              ⚠️ Zablokowane wiadomości
              {data.stats.blockedTruncated && (
                <span className="sec-note"> — ostatnie {data.blocked.length}</span>
              )}
            </h2>
            {data.blocked.length === 0 ? (
              <div className="sec-ok">
                ✅ Nikt jeszcze nie próbował — albo filtr wejścia nic nie złapał.
              </div>
            ) : (
              <div className="sec-logs">
                {data.blocked.map((b) => (
                  <div key={b.id} className="sec-log">
                    <div className="sec-log-head">
                      <span className="sec-log-who">{b.who}</span>
                      <span className="sec-log-reason">{b.reason}</span>
                      <span className="sec-log-when">{when(b.createdAt)}</span>
                    </div>
                    {/* Treść jest tu tylko po to, żeby rozpoznać atak — dlatego
                        excerpt, nie cała wiadomość (tak zapisuje ją guard.ts). */}
                    <div className="sec-log-text">
                      {b.excerpt ? `„${b.excerpt}…”` : "(brak zapisanej treści)"}
                    </div>
                    <div className="sec-log-meta">
                      {b.length} {plural(b.length, "znak", "znaki", "znaków")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      <style jsx>{`
        .sec-wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 8px 4px 40px;
        }
        .sec-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 20px;
        }
        .sec-title {
          font-size: 28px;
          font-weight: 700;
          margin: 0 0 4px;
        }
        .sec-sub {
          margin: 0;
          color: var(--muted);
          font-size: 14px;
        }
        .sec-refresh {
          background: var(--surface);
          border: 1px solid var(--surface-2);
          color: var(--muted-strong);
          border-radius: 10px;
          padding: 10px 16px;
          font: inherit;
          font-size: 14px;
          cursor: pointer;
          white-space: nowrap;
        }
        .sec-refresh:hover:not(:disabled) {
          border-color: #5b6cff;
        }
        .sec-refresh:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .sec-error,
        .sec-warn {
          padding: 12px 14px;
          border-radius: 10px;
          margin-bottom: 12px;
          font-size: 14px;
        }
        .sec-error {
          background: var(--danger-bg);
          border: 1px solid var(--danger-border);
          color: var(--danger-text);
        }
        .sec-warn {
          background: var(--warn-bg);
          border: 1px solid var(--warn-bg);
          color: var(--warn-text);
        }
        .sec-muted {
          color: var(--muted);
          padding: 12px 0;
          font-size: 14px;
        }
        .sec-ok {
          color: var(--ok-text);
          font-size: 14px;
          padding: 14px 16px;
          border: 1px dashed var(--ok-border);
          border-radius: 12px;
        }

        /* Kafelki statystyk */
        .sec-tiles {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
          margin-bottom: 26px;
        }

        .sec-block {
          margin-bottom: 28px;
        }
        .sec-h2 {
          font-size: 17px;
          font-weight: 600;
          margin: 0 0 12px;
        }
        .sec-note {
          font-weight: 400;
          font-size: 13px;
          color: var(--muted);
        }

        /* Alerty */
        .sec-alerts {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .sec-alert {
          display: grid;
          grid-template-columns: 24px minmax(0, 1fr) auto;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid var(--surface-2);
          background: var(--surface-3);
        }
        .sec-alert.red {
          border-color: var(--danger-border);
          background: var(--danger-bg);
        }
        .sec-alert.amber {
          border-color: var(--warn-bg);
          background: var(--warn-bg);
        }
        .sec-alert-icon {
          font-size: 18px;
        }
        .sec-alert-title {
          font-size: 14px;
          font-weight: 600;
        }
        .sec-alert-detail {
          font-size: 13px;
          color: #a5a5b5;
          margin-top: 2px;
        }
        .sec-alert-when {
          font-size: 12px;
          color: #7a7a8a;
          white-space: nowrap;
        }

        /* Tabela top 5 */
        .sec-table {
          border: 1px solid var(--surface-2);
          border-radius: 14px;
          overflow: hidden;
        }
        .sec-row {
          display: grid;
          grid-template-columns: minmax(0, 2fr) 90px 90px 80px 160px;
          gap: 12px;
          align-items: center;
          padding: 12px 16px;
          font-size: 14px;
          border-top: 1px solid var(--border-soft);
        }
        .sec-row-head {
          border-top: none;
          background: var(--surface-3);
          color: var(--muted);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .sec-who {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sec-num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .sec-bar-cell {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sec-bar {
          flex: 1;
          height: 8px;
          background: var(--border-soft);
          border-radius: 999px;
          overflow: hidden;
        }
        .sec-fill {
          display: block;
          height: 100%;
          background: #5b6cff;
        }
        .sec-fill.warn {
          background: #e0a63c;
        }
        .sec-fill.over {
          background: #e05a5a;
        }
        .sec-pct {
          font-size: 12px;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
          min-width: 34px;
          text-align: right;
        }

        /* Logi zablokowanych */
        .sec-logs {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .sec-log {
          background: var(--surface-3);
          border: 1px solid var(--surface-2);
          border-left: 3px solid #e05a5a;
          border-radius: 12px;
          padding: 12px 14px;
        }
        .sec-log-head {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 6px;
        }
        .sec-log-who {
          font-size: 14px;
          font-weight: 600;
        }
        .sec-log-reason {
          font-size: 12px;
          color: var(--danger-text);
          background: var(--danger-bg);
          border: 1px solid var(--danger-border);
          border-radius: 999px;
          padding: 2px 10px;
        }
        .sec-log-when {
          margin-left: auto;
          font-size: 12px;
          color: #7a7a8a;
        }
        .sec-log-text {
          font-size: 13px;
          color: var(--muted-strong);
          line-height: 1.5;
          word-break: break-word;
        }
        .sec-log-meta {
          font-size: 12px;
          color: var(--muted-dim);
          margin-top: 6px;
        }

        /* Wąski ekran: tabela zwija się do dwóch kolumn etykieta/wartość
           byłaby przesadą — wystarczy poziomy scroll na samej tabeli. */
        @media (max-width: 760px) {
          .sec-table {
            overflow-x: auto;
          }
          .sec-row {
            min-width: 620px;
          }
        }
      `}</style>
    </div>
  );
}

function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "red";
}) {
  return (
    <div className={tone === "red" ? "tile tile-red" : "tile"}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-note">{note}</div>

      <style jsx>{`
        .tile {
          background: var(--surface-3);
          border: 1px solid var(--surface-2);
          border-radius: 14px;
          padding: 14px 16px;
        }
        .tile-red {
          border-color: var(--danger-border);
        }
        .tile-label {
          font-size: 12px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .tile-value {
          font-size: 24px;
          font-weight: 700;
          margin: 4px 0 2px;
          font-variant-numeric: tabular-nums;
        }
        .tile-note {
          font-size: 12px;
          color: var(--muted-dim);
        }
      `}</style>
    </div>
  );
}
