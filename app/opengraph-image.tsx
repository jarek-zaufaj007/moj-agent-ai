import { ImageResponse } from "next/og";

// Podgląd linku w social mediach (Lekcja 11 / Warsztat 4).
// Next sam podpina ten plik jako og:image — wystarczy, że leży w app/.
// Obrazek generuje się w buildzie, więc nie trzeba trzymać PNG-a w repo.

export const alt = "Mój Agent — centrum dowodzenia AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 88px",
          background:
            "linear-gradient(135deg, #0a0a12 0%, #131233 55%, #1b1140 100%)",
          color: "#ededed",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Rozmyta poświata w rogu — ten sam klimat co landing page */}
        <div
          style={{
            position: "absolute",
            top: -220,
            right: -160,
            width: 620,
            height: 620,
            borderRadius: 620,
            background: "radial-gradient(circle, #7c3aed 0%, transparent 70%)",
            opacity: 0.55,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -260,
            left: -180,
            width: 640,
            height: 640,
            borderRadius: 640,
            background: "radial-gradient(circle, #2563eb 0%, transparent 70%)",
            opacity: 0.5,
            display: "flex",
          }}
        />

        {/* Logo + nazwa */}
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <RobotMark />
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>
            Mój Agent
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 74,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: -2,
            marginTop: 34,
            maxWidth: 900,
          }}
        >
          Twoje centrum dowodzenia AI
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 31,
            color: "#b9bcd0",
            marginTop: 24,
            maxWidth: 860,
            lineHeight: 1.4,
          }}
        >
          Agent z bazą wiedzy, pamięcią rozmów i automatyzacją — 20+ narzędzi w
          jednym panelu.
        </div>

        {/* Pasek „tagów” na dole */}
        <div style={{ display: "flex", gap: 14, marginTop: 46 }}>
          {["Baza wiedzy (RAG)", "Agent ReAct", "Briefingi", "Raporty"].map(
            (tag) => (
              <div
                key={tag}
                style={{
                  display: "flex",
                  fontSize: 23,
                  color: "#d6d8e8",
                  padding: "11px 22px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.20)",
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                {tag}
              </div>
            ),
          )}
        </div>
      </div>,
      size,
    );
}

// Ten sam znaczek co favicon/ikona PWA, tylko w SVG (Satori nie rysuje emoji
// bez pobierania fontu z sieci, więc robot jest narysowany wektorowo).
function RobotMark() {
  return (
    <svg width="76" height="76" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="22" fill="url(#g)" />
      <circle cx="50" cy="18.5" r="5.8" fill="#fff" />
      <rect x="48.3" y="20" width="3.4" height="20" fill="#fff" />
      <rect x="13" y="47" width="7" height="16" rx="3.5" fill="#fff" />
      <rect x="80" y="47" width="7" height="16" rx="3.5" fill="#fff" />
      <rect x="22" y="36" width="56" height="44" rx="13" fill="#fff" />
      <circle cx="38.5" cy="53" r="6.2" fill="#1b2a6b" />
      <circle cx="61.5" cy="53" r="6.2" fill="#1b2a6b" />
      <rect x="40" y="65.5" width="20" height="4" rx="2" fill="#1b2a6b" />
    </svg>
  );
}
