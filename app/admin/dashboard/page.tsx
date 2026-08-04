"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BarChart, DonutChart, LineChart } from "./charts";

// Dashboard użycia (Lekcja 11, Warsztat 2).
//
// Deska rozdzielcza agenta: ilu userów, ile rozmów, ile tokenów i ile to
// kosztuje. Strona sama NIE czyta bazy — api_usage ma RLS bez polityk, a
// e-maile siedzą w auth.users, więc anon key i tak nic by nie zobaczył.
// Wszystko liczy /api/admin/dashboard kluczem service_role; tu zostaje samo
// rysowanie.

type Daily = {
  key: string;
  label: string;
  tokens: number;
  cost: number;
  conversations: number;
};

type Endpoint = { endpoint: string; tokens: number; cost: number; calls: number };

type Recent = {
  id: string;
  title: string;
  who: string;
  createdAt: string;
  updatedAt: string;
  messages: number;
};

type Stats = {
  users: number;
  conversations: number;
  conversationsTruncated: boolean;
  messages: number;
  tokensToday: number;
  costToday: number;
  callsToday: number;
  tokensWeek: number;
  costWeek: number;
  days: number;
};

type Payload = {
  ok: boolean;
  stats: Stats;
  daily: Daily[];
  byEndpoint: Endpoint[];
  recent: Recent[];
  warnings: string[];
  error?: string;
};

const num = (n: number) => n.toLocaleString("pl-PL");

// Rachunki wychodzą tu w setnych centa, więc dwa miejsca po przecinku pokazują
// wyłącznie "$0.00". Poniżej centa schodzimy na cztery cyfry — to nadal
// prawdziwa liczba, a nie zaokrąglone zero.
function usd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

// Polski ma trzy formy liczby mnogiej: 1 rozmowa, 2–4 rozmowy, 5+ rozmów.
// Wyjątek to nastki (12–14), które mimo końcówki 2–4 biorą formę "wielu".
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

export default function AdminDashboardPage() {
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

      const res = await fetch("/api/admin/dashboard", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json: Payload = await res.json();

      if (!res.ok || !json.ok) {
        setError(json.error ?? "Nie udało się wczytać danych dashboardu.");
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

  // Pierścień pokazuje maks. 6 endpointów + "pozostałe" — przy dwunastu
  // kolorowych wycinkach nie da się już odczytać, który jest który.
  const TOP_SLICES = 6;
  const slices = (() => {
    const rows = data?.byEndpoint ?? [];
    if (rows.length <= TOP_SLICES) {
      return rows.map((r) => ({ label: r.endpoint, value: r.tokens }));
    }
    const head = rows.slice(0, TOP_SLICES);
    const rest = rows.slice(TOP_SLICES).reduce((s, r) => s + r.tokens, 0);
    return [
      ...head.map((r) => ({ label: r.endpoint, value: r.tokens })),
      { label: `pozostałe (${rows.length - TOP_SLICES})`, value: rest },
    ];
  })();

  return (
    <div className="dash-wrap">
      <div className="dash-head">
        <div>
          <h1 className="dash-title">📊 Dashboard</h1>
          <p className="dash-sub">
            Ile rozmów, ilu userów, ile tokenów i ile to kosztuje
          </p>
        </div>
        <div className="dash-actions">
          <Link href="/admin/security" className="dash-link">
            🛡️ Bezpieczeństwo
          </Link>
          <button className="dash-refresh" onClick={load} disabled={loading}>
            {loading ? "⏳ Wczytuję…" : "🔄 Odśwież"}
          </button>
        </div>
      </div>

      {error && <div className="dash-error">⚠️ {error}</div>}
      {data?.warnings.map((w) => (
        <div key={w} className="dash-warn">
          ⚙️ {w}
        </div>
      ))}

      {loading && !data ? (
        <div className="dash-muted">Zbieram dane…</div>
      ) : data ? (
        <>
          {/* ── Karty z liczbami ───────────────────────────────────────── */}
          <div className="dash-tiles">
            <Tile
              icon="👥"
              label="Użytkownicy"
              value={num(data.stats.users)}
              note="z zapisanymi rozmowami"
            />
            <Tile
              icon="💬"
              label="Rozmowy"
              value={num(data.stats.conversations)}
              note={`${num(data.stats.messages)} ${plural(
                data.stats.messages,
                "wiadomość",
                "wiadomości",
                "wiadomości",
              )} łącznie`}
            />
            <Tile
              icon="🔤"
              label="Tokeny dziś"
              value={num(data.stats.tokensToday)}
              note={`${num(data.stats.callsToday)} ${plural(
                data.stats.callsToday,
                "wywołanie",
                "wywołania",
                "wywołań",
              )} modelu`}
            />
            <Tile
              icon="💰"
              label="Koszt dziś"
              value={usd(data.stats.costToday)}
              note={`${usd(data.stats.costWeek)} przez ${data.stats.days} dni`}
            />
          </div>

          {data.stats.conversationsTruncated && (
            <div className="dash-warn">
              ⚙️ Lista rozmów została ucięta do 5000 — liczba użytkowników i
              wykres rozmów liczą tylko tę część.
            </div>
          )}

          {/* ── Wykresy ────────────────────────────────────────────────── */}
          <div className="dash-charts">
            <section className="dash-card">
              <h2 className="dash-h2">🔤 Tokeny per dzień</h2>
              <p className="dash-hint">
                Ostatnie {data.stats.days} dni. Najedź na punkt, żeby zobaczyć koszt.
              </p>
              <LineChart
                points={data.daily.map((d) => ({
                  label: d.label,
                  value: d.tokens,
                  hint: `${d.label}: ${num(d.tokens)} tokenów · ${usd(d.cost)}`,
                }))}
              />
            </section>

            <section className="dash-card">
              <h2 className="dash-h2">💬 Rozmowy per dzień</h2>
              <p className="dash-hint">
                Liczone po dacie założenia rozmowy, nie po ostatniej wiadomości.
              </p>
              <BarChart
                points={data.daily.map((d) => ({
                  label: d.label,
                  value: d.conversations,
                  hint: `${d.label}: ${d.conversations} ${plural(
                    d.conversations,
                    "rozmowa",
                    "rozmowy",
                    "rozmów",
                  )}`,
                }))}
              />
            </section>
          </div>

          <section className="dash-card">
            <h2 className="dash-h2">🥧 Tokeny per endpoint</h2>
            <p className="dash-hint">
              Który ekran zjada budżet. Ostatnie {data.stats.days} dni.
            </p>
            {slices.length === 0 ? (
              <div className="dash-muted">
                Brak zapisanego zużycia — porozmawiaj z agentem i odśwież.
              </div>
            ) : (
              <>
                <DonutChart
                  slices={slices}
                  total={data.stats.tokensWeek}
                  centerLabel={num(data.stats.tokensWeek)}
                  centerNote="tokenów"
                />
                <div className="dash-table dash-endpoints">
                  <div className="dash-row dash-row-head">
                    <span>Endpoint</span>
                    <span className="dash-num">Tokeny</span>
                    <span className="dash-num">Wywołań</span>
                    <span className="dash-num">Koszt</span>
                  </div>
                  {data.byEndpoint.map((e) => (
                    <div key={e.endpoint} className="dash-row">
                      <span className="dash-ellipsis">{e.endpoint}</span>
                      <span className="dash-num">{num(e.tokens)}</span>
                      <span className="dash-num">{num(e.calls)}</span>
                      <span className="dash-num">{usd(e.cost)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* ── Ostatnie rozmowy ───────────────────────────────────────── */}
          <section className="dash-card">
            <h2 className="dash-h2">🕘 Ostatnie rozmowy</h2>
            {data.recent.length === 0 ? (
              <div className="dash-muted">Jeszcze nikt nie zaczął rozmowy.</div>
            ) : (
              <div className="dash-table dash-recent">
                <div className="dash-row dash-row-head">
                  <span>Użytkownik</span>
                  <span>Tytuł</span>
                  <span>Rozpoczęta</span>
                  <span className="dash-num">Wiadomości</span>
                </div>
                {data.recent.map((c) => (
                  <div key={c.id} className="dash-row">
                    <span className="dash-ellipsis" title={c.who}>
                      {c.who}
                    </span>
                    {/* Podgląd rozmowy leży pod /history/[id] — z dashboardu
                        chcemy jednym kliknięciem zobaczyć, o co w niej szło. */}
                    <Link href={`/history/${c.id}`} className="dash-conv" title={c.title}>
                      {c.title}
                    </Link>
                    <span className="dash-when">{when(c.createdAt)}</span>
                    <span className="dash-num">{num(c.messages)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <p className="dash-foot">
            💡 Koszt to szacunek według cennika wpisanego w{" "}
            <code>app/api/admin/dashboard/route.ts</code> (stała <code>PRICING</code>) —
            nie rachunek od Google. Zmienią stawki, popraw je tam.
          </p>
        </>
      ) : null}

      <style jsx>{`
        .dash-wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 8px 4px 40px;
        }
        .dash-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 20px;
        }
        .dash-title {
          font-size: 28px;
          font-weight: 700;
          margin: 0 0 4px;
        }
        .dash-sub {
          margin: 0;
          color: var(--muted);
          font-size: 14px;
        }
        .dash-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .dash-refresh,
        .dash-link {
          background: var(--surface);
          border: 1px solid var(--surface-2);
          color: var(--muted-strong);
          border-radius: 10px;
          padding: 10px 16px;
          font: inherit;
          font-size: 14px;
          cursor: pointer;
          white-space: nowrap;
          text-decoration: none;
        }
        .dash-refresh:hover:not(:disabled),
        .dash-link:hover {
          border-color: #5b6cff;
        }
        .dash-refresh:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .dash-error,
        .dash-warn {
          padding: 12px 14px;
          border-radius: 10px;
          margin-bottom: 12px;
          font-size: 14px;
        }
        .dash-error {
          background: var(--danger-bg);
          border: 1px solid var(--danger-border);
          color: var(--danger-text);
        }
        .dash-warn {
          background: var(--warn-bg);
          border: 1px solid var(--warn-bg);
          color: var(--warn-text);
        }
        .dash-muted {
          color: var(--muted);
          padding: 12px 0;
          font-size: 14px;
        }

        /* Karty z liczbami */
        .dash-tiles {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }

        /* Wykresy — dwa obok siebie, na wąskim ekranie jeden pod drugim */
        .dash-charts {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
          gap: 16px;
        }
        .dash-card {
          background: var(--surface-3);
          border: 1px solid var(--surface-2);
          border-radius: 16px;
          padding: 16px 18px;
          margin-bottom: 16px;
          /* Bez tego wykres w gridzie rozpycha kolumnę zamiast się zmieścić. */
          min-width: 0;
        }
        .dash-charts .dash-card {
          margin-bottom: 0;
        }
        .dash-h2 {
          font-size: 16px;
          font-weight: 600;
          margin: 0 0 2px;
        }
        .dash-hint {
          margin: 0 0 14px;
          font-size: 12px;
          color: var(--muted-dim);
        }

        /* Tabele */
        .dash-table {
          border: 1px solid var(--surface-2);
          border-radius: 14px;
          overflow: hidden;
        }
        .dash-endpoints {
          margin-top: 18px;
        }
        .dash-row {
          display: grid;
          gap: 12px;
          align-items: center;
          padding: 11px 16px;
          font-size: 14px;
          border-top: 1px solid var(--border-soft);
        }
        .dash-endpoints .dash-row {
          grid-template-columns: minmax(0, 2fr) 110px 90px 90px;
        }
        .dash-recent .dash-row {
          grid-template-columns: minmax(0, 1.2fr) minmax(0, 2fr) 130px 110px;
        }
        .dash-row-head {
          border-top: none;
          background: var(--surface-3);
          color: var(--muted);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .dash-ellipsis,
        .dash-conv,
        .dash-when {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dash-conv {
          color: var(--accent-link);
          text-decoration: none;
        }
        .dash-conv:hover {
          text-decoration: underline;
        }
        .dash-when {
          color: var(--muted);
          font-size: 13px;
        }
        .dash-num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .dash-foot {
          font-size: 12px;
          color: var(--muted-dim);
          line-height: 1.6;
        }
        .dash-foot code {
          background: var(--surface-3);
          border: 1px solid var(--surface-2);
          border-radius: 5px;
          padding: 1px 5px;
        }

        /* Wąski ekran: tabele dostają poziomy scroll zamiast zgniatać kolumny */
        @media (max-width: 760px) {
          .dash-table {
            overflow-x: auto;
          }
          .dash-endpoints .dash-row {
            min-width: 560px;
          }
          .dash-recent .dash-row {
            min-width: 620px;
          }
        }
      `}</style>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  note,
}: {
  icon: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="tile">
      <div className="tile-label">
        <span className="tile-icon">{icon}</span> {label}
      </div>
      <div className="tile-value">{value}</div>
      <div className="tile-note">{note}</div>

      <style jsx>{`
        .tile {
          background: var(--surface-3);
          border: 1px solid var(--surface-2);
          border-radius: 14px;
          padding: 14px 16px;
        }
        .tile-label {
          font-size: 12px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .tile-icon {
          font-size: 13px;
        }
        .tile-value {
          font-size: 26px;
          font-weight: 700;
          margin: 6px 0 2px;
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
