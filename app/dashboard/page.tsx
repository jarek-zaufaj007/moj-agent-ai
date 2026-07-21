"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// ── Typy danych z /api/dashboard ────────────────────────────────────────────
type Weather =
  | {
      city: string;
      temperature: number;
      humidity: number;
      windSpeed: number;
      description: string;
      emoji: string;
    }
  | { error: string };

type Currency =
  | { currency: string; rate: number; date: string; delta: number; source: string }
  | { currency: string; error: string };

type Holidays =
  | { holidays: { date: string; localName: string }[]; daysUntilNext: number | null }
  | { error: string };

type DashboardData = {
  dateTime: { full: string; time: string; greeting: string };
  weather: Weather;
  currencies: Currency[];
  holidays: Holidays;
  updatedAt: string;
};

const DEFAULT_CITY = "Warszawa";

const QUICK_ACTIONS = [
  { href: "/travel", emoji: "🌍", label: "Zaplanuj podróż" },
  { href: "/react", emoji: "🔄", label: "Agent ReAct" },
  { href: "/chat", emoji: "💬", label: "Chat z agentem" },
  { href: "/think", emoji: "🧠", label: "Tryb myślenia" },
  { href: "/generate", emoji: "🎨", label: "Generator grafik" },
  { href: "/fewshot", emoji: "📚", label: "Słownik AI" },
];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtHolidayDate(date: string) {
  return new Date(date).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
  });
}

// ── Karta bazowa (glassmorphism) ────────────────────────────────────────────
function Card({
  gradient,
  border,
  delay,
  children,
}: {
  gradient: string;
  border: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fade-in-up"
      style={{
        background: gradient,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: `1px solid ${border}`,
        borderRadius: 16,
        padding: 18,
        animationDelay: `${delay}ms`,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 180,
      }}
    >
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.4, opacity: 0.9 }}>
      {children}
    </div>
  );
}

function Skeleton({ w, h }: { w: number | string; h: number }) {
  return <div className="skeleton" style={{ width: w, height: h }} />;
}

function CardSkeleton({ delay }: { delay: number }) {
  return (
    <Card gradient="#12121c" border="#26263a" delay={delay}>
      <Skeleton w={120} h={16} />
      <Skeleton w="80%" h={28} />
      <Skeleton w="60%" h={16} />
      <Skeleton w="70%" h={16} />
    </Card>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    if (firstLoad.current) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard?city=${encodeURIComponent(DEFAULT_CITY)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as DashboardData);
    } catch {
      setError("Nie udało się pobrać danych. Spróbuj odświeżyć.");
    } finally {
      firstLoad.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Pogodę/dane odświeżaj co 15 minut (kursy NBP i tak zmieniają się raz dziennie).
    const id = setInterval(load, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const updated = data ? `Aktualizacja: ${fmtTime(data.updatedAt)}` : "";

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 16px 48px" }}>
      {/* Nagłówek powitalny */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            🌅 {data ? `${data.dateTime.greeting}!` : "Ładowanie…"}
          </div>
          <div style={{ fontSize: 14, color: "#9aa", marginTop: 4 }}>
            {data
              ? `Dziś: ${data.dateTime.full} · ${data.dateTime.time}`
              : "Pobieram aktualne dane…"}
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading || refreshing}
          title="Odśwież dane"
          style={{
            background: "#15151f",
            border: "1px solid #333",
            borderRadius: 10,
            color: "#ededed",
            padding: "8px 14px",
            fontSize: 14,
            cursor: loading || refreshing ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              display: "inline-block",
              animation: refreshing ? "pulse 1s linear infinite" : "none",
            }}
          >
            🔄
          </span>
          {refreshing ? "Odświeżam…" : "Odśwież"}
        </button>
      </header>

      {error && (
        <div
          style={{
            background: "#2a1010",
            border: "1px solid #a33",
            borderRadius: 12,
            color: "#f0b0b0",
            padding: "12px 14px",
            marginBottom: 16,
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Siatka kart */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {loading || !data ? (
          <>
            <CardSkeleton delay={0} />
            <CardSkeleton delay={80} />
            <CardSkeleton delay={160} />
            <CardSkeleton delay={240} />
          </>
        ) : (
          <>
            {/* POGODA */}
            <Card
              gradient="linear-gradient(135deg, rgba(30,58,90,0.55), rgba(8,60,80,0.45))"
              border="rgba(56,189,248,0.35)"
              delay={0}
            >
              <CardTitle>🌤️ POGODA</CardTitle>
              {"error" in data.weather ? (
                <div style={{ color: "#f0b0b0" }}>🔴 {data.weather.error}</div>
              ) : (
                <>
                  <div style={{ fontSize: 15, color: "#cde" }}>
                    {data.weather.city}
                  </div>
                  <div style={{ fontSize: 34, fontWeight: 800 }}>
                    {data.weather.emoji} {Math.round(data.weather.temperature)}°C
                  </div>
                  <div style={{ fontSize: 14, color: "#bcd", textTransform: "capitalize" }}>
                    {data.weather.description}
                  </div>
                  <div style={{ fontSize: 13, color: "#9ab" }}>
                    💨 Wiatr: {data.weather.windSpeed} km/h · 💧 Wilgotność:{" "}
                    {data.weather.humidity}%
                  </div>
                </>
              )}
              <div style={{ marginTop: "auto", fontSize: 11, color: "#7a8" }}>
                {updated}
              </div>
            </Card>

            {/* KURSY WALUT */}
            <Card
              gradient="linear-gradient(135deg, rgba(16,66,45,0.55), rgba(8,70,55,0.45))"
              border="rgba(52,211,153,0.35)"
              delay={80}
            >
              <CardTitle>💶 KURSY WALUT</CardTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.currencies.map((c) =>
                  "error" in c ? (
                    <div key={c.currency} style={{ color: "#f0b0b0", fontSize: 13 }}>
                      🔴 {c.currency}: {c.error}
                    </div>
                  ) : (
                    <div
                      key={c.currency}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: 16,
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>{c.currency}</span>
                      <span>
                        {c.rate?.toFixed(4)} PLN{" "}
                        <span
                          style={{
                            color:
                              c.delta > 0 ? "#4ade80" : c.delta < 0 ? "#f87171" : "#9ab",
                            fontSize: 13,
                          }}
                        >
                          {c.delta > 0 ? "↑" : c.delta < 0 ? "↓" : "→"}{" "}
                          {Math.abs(c.delta).toFixed(4)}
                        </span>
                      </span>
                    </div>
                  ),
                )}
              </div>
              <div style={{ marginTop: "auto", fontSize: 11, color: "#7a8" }}>
                {"error" in data.currencies[0]
                  ? updated
                  : `Kurs z: ${(data.currencies[0] as { date: string }).date} (NBP) · ${updated}`}
              </div>
            </Card>

            {/* NADCHODZĄCE ŚWIĘTA */}
            <Card
              gradient="linear-gradient(135deg, rgba(90,55,16,0.55), rgba(90,70,8,0.45))"
              border="rgba(245,158,11,0.35)"
              delay={160}
            >
              <CardTitle>📅 NADCHODZĄCE ŚWIĘTA</CardTitle>
              {"error" in data.holidays ? (
                <div style={{ color: "#f0b0b0" }}>🔴 {data.holidays.error}</div>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {data.holidays.holidays.map((h) => (
                      <div
                        key={h.date}
                        style={{ fontSize: 14, display: "flex", gap: 8 }}
                      >
                        <span style={{ color: "#fbbf24", minWidth: 58 }}>
                          {fmtHolidayDate(h.date)}
                        </span>
                        <span style={{ color: "#edd" }}>{h.localName}</span>
                      </div>
                    ))}
                  </div>
                  {data.holidays.daysUntilNext != null && (
                    <div style={{ marginTop: "auto", fontSize: 13, color: "#fcd34d" }}>
                      ⏳ Następne za: {data.holidays.daysUntilNext} dni
                    </div>
                  )}
                </>
              )}
            </Card>

            {/* SZYBKIE AKCJE */}
            <Card
              gradient="linear-gradient(135deg, rgba(76,29,110,0.55), rgba(110,20,80,0.45))"
              border="rgba(217,70,239,0.35)"
              delay={240}
            >
              <CardTitle>🤖 SZYBKIE AKCJE</CardTitle>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                {QUICK_ACTIONS.map((a) => (
                  <Link key={a.href} href={a.href} className="quick-action">
                    <span>{a.emoji}</span>
                    {a.label}
                  </Link>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
