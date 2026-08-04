"use client";

import Link from "next/link";

// ── Landing page (Lekcja 11 / Warsztat 1) ───────────────────────────────────
// Strona "/" dla niezalogowanych: hero + funkcje + mockupy interfejsu + CTA.
// Zalogowany użytkownik nigdy tego nie zobaczy — app/page.tsx przełącza na
// dashboard. Style: inline dla układu, klasy .lp-* w globals.css dla animacji
// i efektów hover.

const FEATURES = [
  {
    emoji: "🧠",
    title: "Pamięta Twoje rozmowy",
    desc: "Historia czatów zapisana na stałe. Wróć po tygodniu i kontynuuj w miejscu, w którym skończyłeś.",
    accent: "#a78bfa",
  },
  {
    emoji: "📚",
    title: "Zna dokumenty Twojej firmy",
    desc: "Wrzuć cennik, ofertę czy regulamin. Agent odpowiada z Twoich plików i podaje źródło (RAG).",
    accent: "#38bdf8",
  },
  {
    emoji: "🔐",
    title: "Prywatne dane per user",
    desc: "Logowanie i izolacja na poziomie bazy (RLS). Nikt poza Tobą nie zobaczy Twoich dokumentów.",
    accent: "#34d399",
  },
  {
    emoji: "⚡",
    title: "Pracuje 24/7",
    desc: "Poranne briefingi i webhooki odpalają się same — agent działa, nawet gdy śpisz.",
    accent: "#fbbf24",
  },
];

const STATS = [
  { value: "20+", label: "narzędzi w jednym panelu" },
  { value: "24/7", label: "automatyczne briefingi" },
  { value: "30 s", label: "od rejestracji do 1. odpowiedzi" },
];

const STEPS = [
  {
    n: "1",
    title: "Załóż konto",
    desc: "E-mail i hasło. Bez karty, bez formularza handlowego.",
  },
  {
    n: "2",
    title: "Wgraj dokumenty",
    desc: "PDF-y i teksty trafiają do bazy wiedzy agenta.",
  },
  {
    n: "3",
    title: "Pytaj po ludzku",
    desc: "Agent odpowiada z Twoich danych i pokazuje, skąd je wziął.",
  },
];

const MINI_MOCKUPS = [
  {
    emoji: "🏠",
    title: "Dashboard",
    desc: "Pogoda, kursy NBP i święta w jednym rzucie oka.",
    rows: ["🌤️ Warszawa · 21°C", "💶 EUR 4,2841 ↑", "📅 Najbliższe święto: 15 sie"],
    accent: "rgba(56,189,248,0.35)",
  },
  {
    emoji: "📚",
    title: "Baza wiedzy",
    desc: "Dokumenty pocięte na fragmenty i zaindeksowane.",
    rows: ["📄 cennik-2026.pdf", "📄 regulamin.pdf", "🔍 142 fragmenty gotowe"],
    accent: "rgba(167,139,250,0.35)",
  },
  {
    emoji: "📰",
    title: "Briefingi",
    desc: "Codzienne podsumowanie generowane o 7:00 rano.",
    rows: ["🗞️ Briefing · dziś 07:00", "🗞️ Briefing · wczoraj", "⏰ Następny za 14 h"],
    accent: "rgba(52,211,153,0.35)",
  },
];

// ── Małe elementy pomocnicze ────────────────────────────────────────────────

function Section({
  id,
  children,
  style,
}: {
  id?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section id={id} style={{ padding: "72px 0", ...style }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 20px" }}>
        {children}
      </div>
    </section>
  );
}

function SectionTitle({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div style={{ textAlign: "center", marginBottom: 40 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color: "#7dd3fc",
          marginBottom: 10,
        }}
      >
        {eyebrow}
      </div>
      <h2 className="lp-h2">{title}</h2>
      {subtitle && (
        <p
          style={{
            margin: "12px auto 0",
            maxWidth: 620,
            color: "#9ca3af",
            fontSize: 16,
            lineHeight: 1.6,
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

// Pasek tytułowy „okna przeglądarki” w mockupach.
function WindowBar({ label }: { label: string }) {
  return (
    <div className="lp-window-bar">
      <span className="lp-dot" style={{ background: "#ff5f57" }} />
      <span className="lp-dot" style={{ background: "#febc2e" }} />
      <span className="lp-dot" style={{ background: "#28c840" }} />
      <span className="lp-window-url">{label}</span>
    </div>
  );
}

// ── Landing ─────────────────────────────────────────────────────────────────

export function LandingPage() {
  return (
    <div className="lp">
      {/* Animowane tło: rozmyte plamy koloru + delikatna siatka */}
      <div className="lp-bg" aria-hidden>
        <span className="lp-blob lp-blob-1" />
        <span className="lp-blob lp-blob-2" />
        <span className="lp-blob lp-blob-3" />
        <span className="lp-grid" />
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>
        {/* ── Górny pasek ─────────────────────────────────────────────── */}
        <header className="lp-nav">
          <div className="lp-nav-inner">
            <span className="lp-brand">🤖 Mój Agent</span>
            <nav style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <a href="#funkcje" className="lp-nav-link lp-hide-mobile">
                Funkcje
              </a>
              <a href="#demo" className="lp-nav-link lp-hide-mobile">
                Demo
              </a>
              <Link href="/login" className="lp-nav-link">
                Zaloguj się
              </Link>
              <Link href="/login" className="lp-cta lp-cta-sm">
                Zacznij za darmo
              </Link>
            </nav>
          </div>
        </header>

        {/* ── Hero ────────────────────────────────────────────────────── */}
        <Section style={{ padding: "88px 0 64px" }}>
          <div style={{ textAlign: "center" }}>
            <div className="lp-badge fade-in-up">
              <span className="lp-pulse-dot" />
              20+ narzędzi AI w jednym panelu
            </div>

            <h1
              className="lp-h1 fade-in-up"
              style={{ animationDelay: "80ms", marginTop: 22 }}
            >
              Twój osobisty agent AI,
              <br />
              który <span className="lp-gradient-text">zna Twoje dokumenty</span>
            </h1>

            <p
              className="fade-in-up"
              style={{
                animationDelay: "160ms",
                margin: "20px auto 0",
                maxWidth: 640,
                fontSize: 18,
                lineHeight: 1.65,
                color: "#9ca3af",
              }}
            >
              Czat, baza wiedzy, raporty i automatyczne briefingi — wszystko
              w jednym miejscu. Pytasz normalnym językiem, agent odpowiada
              z <strong style={{ color: "#e5e7eb" }}>Twoich</strong> danych
              i pokazuje źródło.
            </p>

            <div
              className="fade-in-up lp-hero-actions"
              style={{ animationDelay: "240ms" }}
            >
              <Link href="/login" className="lp-cta lp-cta-lg">
                🚀 Zacznij za darmo
              </Link>
              <a href="#demo" className="lp-cta-ghost">
                Zobacz, jak działa ↓
              </a>
            </div>

            <div
              className="fade-in-up"
              style={{
                animationDelay: "320ms",
                marginTop: 18,
                fontSize: 13,
                color: "#6b7280",
              }}
            >
              Bez karty kredytowej · Konto w 30 sekund · Twoje dane zostają Twoje
            </div>

            {/* Liczby */}
            <div
              className="fade-in-up lp-stats"
              style={{ animationDelay: "400ms" }}
            >
              {STATS.map((s) => (
                <div key={s.label} style={{ textAlign: "center" }}>
                  <div className="lp-stat-value">{s.value}</div>
                  <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 4 }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ── Funkcje ─────────────────────────────────────────────────── */}
        <Section id="funkcje">
          <SectionTitle
            eyebrow="Co potrafi"
            title="Asystent, który naprawdę zna kontekst"
            subtitle="Nie kolejny czatbot z internetu. Agent pracuje na Twoich plikach, Twojej historii i Twoim koncie."
          />

          <div className="lp-grid-cards">
            {FEATURES.map((f, i) => (
              <article
                key={f.title}
                className="lp-card fade-in-up"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div
                  className="lp-card-icon"
                  style={{
                    background: `${f.accent}1f`,
                    border: `1px solid ${f.accent}59`,
                  }}
                >
                  {f.emoji}
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700, marginTop: 14 }}>
                  {f.title}
                </h3>
                <p
                  style={{
                    marginTop: 8,
                    fontSize: 14.5,
                    lineHeight: 1.6,
                    color: "#9ca3af",
                  }}
                >
                  {f.desc}
                </p>
              </article>
            ))}
          </div>
        </Section>

        {/* ── Demo / „screenshoty” ────────────────────────────────────── */}
        <Section id="demo">
          <SectionTitle
            eyebrow="Podgląd"
            title="Zapytaj o cennik — dostaniesz odpowiedź z Twoich dokumentów"
            subtitle="Agent szuka w wgranych plikach, cytuje fragment i podaje nazwę pliku. Żadnego zgadywania."
          />

          {/* Duży mockup: czat */}
          <div className="lp-window fade-in-up">
            <WindowBar label="mój-agent.app/chat" />
            <div className="lp-window-body">
              {/* Mini-sidebar */}
              <aside className="lp-mock-sidebar">
                <div className="lp-mock-brand">🤖 Mój Agent</div>
                {[
                  ["🏠", "Dashboard"],
                  ["💬", "Chat"],
                  ["📚", "Baza wiedzy"],
                  ["📰", "Briefingi"],
                  ["📊", "Raporty"],
                ].map(([e, l], i) => (
                  <div
                    key={l}
                    className={`lp-mock-nav ${i === 1 ? "active" : ""}`}
                  >
                    <span>{e}</span>
                    {l}
                  </div>
                ))}
              </aside>

              {/* Rozmowa */}
              <div className="lp-mock-chat">
                <div className="lp-bubble lp-bubble-user">
                  Ile kosztuje pakiet Premium i co zawiera?
                </div>

                <div className="lp-bubble lp-bubble-ai">
                  Pakiet <strong>Premium</strong> kosztuje{" "}
                  <strong>499 zł netto / miesiąc</strong>. W cenie:
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                    <li>nielimitowane rozmowy z agentem,</li>
                    <li>baza wiedzy do 500 dokumentów,</li>
                    <li>poranne briefingi i wsparcie 24 h.</li>
                  </ul>
                  <div className="lp-source">📄 Źródło: cennik-2026.pdf, s. 3</div>
                </div>

                <div className="lp-bubble lp-bubble-ai lp-typing">
                  <span className="lp-typing-dot" />
                  <span className="lp-typing-dot" />
                  <span className="lp-typing-dot" />
                </div>

                <div className="lp-mock-input">
                  <span style={{ color: "#6b7280" }}>Zadaj pytanie agentowi…</span>
                  <span className="lp-mock-send">➤</span>
                </div>
              </div>
            </div>
          </div>

          {/* Trzy mniejsze „screenshoty” */}
          <div className="lp-grid-mini">
            {MINI_MOCKUPS.map((m, i) => (
              <div
                key={m.title}
                className="lp-card fade-in-up"
                style={{ animationDelay: `${i * 90}ms`, padding: 0 }}
              >
                <div
                  className="lp-mini-screen"
                  style={{ borderBottom: `1px solid ${m.accent}` }}
                >
                  {m.rows.map((r) => (
                    <div key={r} className="lp-mini-row">
                      {r}
                    </div>
                  ))}
                </div>
                <div style={{ padding: "14px 18px 18px" }}>
                  <h3 style={{ fontSize: 15.5, fontWeight: 700 }}>
                    {m.emoji} {m.title}
                  </h3>
                  <p style={{ marginTop: 6, fontSize: 14, color: "#9ca3af" }}>
                    {m.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Jak zacząć ──────────────────────────────────────────────── */}
        <Section style={{ paddingTop: 24 }}>
          <SectionTitle eyebrow="Jak zacząć" title="Trzy kroki i działa" />
          <div className="lp-grid-steps">
            {STEPS.map((s, i) => (
              <div
                key={s.n}
                className="lp-step fade-in-up"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <div className="lp-step-n">{s.n}</div>
                <h3 style={{ fontSize: 16.5, fontWeight: 700 }}>{s.title}</h3>
                <p style={{ marginTop: 6, fontSize: 14.5, color: "#9ca3af" }}>
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* ── CTA końcowe ─────────────────────────────────────────────── */}
        <Section style={{ paddingTop: 8 }}>
          <div className="lp-final-cta fade-in-up">
            <h2 className="lp-h2">Gotowy? Zacznij w 30 sekund.</h2>
            <p
              style={{
                margin: "12px auto 0",
                maxWidth: 520,
                color: "#c7d2fe",
                fontSize: 16.5,
                lineHeight: 1.6,
              }}
            >
              Załóż konto, wgraj pierwszy dokument i zadaj pytanie. Reszta dzieje
              się sama.
            </p>
            <div style={{ marginTop: 26 }}>
              <Link href="/login" className="lp-cta lp-cta-lg">
                Stwórz konto →
              </Link>
            </div>
            <div style={{ marginTop: 14, fontSize: 13, color: "#a5b4fc" }}>
              Masz już konto?{" "}
              <Link href="/login" style={{ color: "#fff", fontWeight: 600 }}>
                Zaloguj się
              </Link>
            </div>
          </div>
        </Section>

        {/* ── Stopka ──────────────────────────────────────────────────── */}
        <footer className="lp-footer">
          <div className="lp-footer-inner">
            <span style={{ fontWeight: 700 }}>🤖 Mój Agent</span>
            <span style={{ color: "#6b7280", fontSize: 13 }}>
              Zbudowany na Next.js, Supabase i Gemini · {new Date().getFullYear()}
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
