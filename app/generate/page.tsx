"use client";

import { useState } from "react";

const EXAMPLES = [
  "Minimalistyczne logo kawiarni w stylu japońskim",
  "Post na Instagram: kawa latte art, ciepłe światło, widok z góry",
  "Kreacja reklamowa: wyprzedaż letnia -50%, nowoczesny design",
  "Ikona aplikacji: robot AI, gradient fioletowo-niebieski, flat design",
  "Infografika: 5 kroków do produktywności, pastelowe kolory",
  "Zdjęcie produktowe: elegancki zegarek na ciemnym tle",
];

export default function GeneratePage() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Prompt użyty do OSTATNIEGO wygenerowanego obrazu (dla "Ponownie").
  const [lastPrompt, setLastPrompt] = useState("");

  async function generate(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setImage(null);
    setComment("");
    setLastPrompt(trimmed);

    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error ?? "Nie udało się wygenerować obrazu.");
        return;
      }

      setImage(data.image);
      setComment(data.text ?? "");
    } catch {
      setError("Błąd połączenia z serwerem. Spróbuj ponownie.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    generate(prompt);
  }

  function download() {
    if (!image) return;
    const a = document.createElement("a");
    a.href = image;
    a.download = "ai-generated.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div
      style={{
        maxWidth: 800,
        margin: "0 auto",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "0 16px",
      }}
    >
      <header style={{ padding: "24px 0 12px", textAlign: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>
          🎨 Generator grafik AI
        </div>
        <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
          Opisz co chcesz - AI stworzy obraz w kilka sekund
        </div>
      </header>

      <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Opisz obraz który chcesz wygenerować..."
          rows={3}
          style={{
            width: "100%",
            background: "#1a1a2a",
            border: "1px solid #333",
            borderRadius: 10,
            color: "#ededed",
            padding: "12px 14px",
            fontSize: 15,
            outline: "none",
            resize: "vertical",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          style={{
            marginTop: 8,
            width: "100%",
            background: "#2a2a3a",
            border: "1px solid #444",
            borderRadius: 10,
            color: "#ededed",
            padding: "12px 20px",
            fontSize: 16,
            cursor: loading || !prompt.trim() ? "not-allowed" : "pointer",
            opacity: loading || !prompt.trim() ? 0.5 : 1,
          }}
        >
          🎨 Generuj
        </button>
      </form>

      {/* Przykładowe prompty */}
      {!image && !loading && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ color: "#888", fontSize: 13, marginBottom: 8 }}>
            Kliknij przykład, aby zacząć:
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setPrompt(ex);
                  generate(ex);
                }}
                style={{
                  background: "#1a1a2a",
                  border: "1px solid #333",
                  borderRadius: 10,
                  color: "#ededed",
                  padding: "8px 12px",
                  fontSize: 13,
                  cursor: "pointer",
                  textAlign: "left",
                  maxWidth: 360,
                }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stan ładowania */}
      {loading && (
        <div
          style={{
            aspectRatio: "1 / 1",
            width: "100%",
            maxWidth: 512,
            margin: "0 auto",
            borderRadius: 12,
            border: "1px solid #333",
            background: "#1a1a2a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#888",
            fontSize: 15,
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        >
          Generuję... (5-15 sekund)
        </div>
      )}

      {/* Błąd */}
      {error && !loading && (
        <div
          style={{
            background: "#2a1a1a",
            border: "1px solid #a33",
            borderRadius: 10,
            color: "#f0b0b0",
            padding: "12px 14px",
            fontSize: 14,
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Wynik */}
      {image && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt="Wygenerowany obraz"
            style={{
              width: "100%",
              maxWidth: 512,
              margin: "0 auto",
              borderRadius: 12,
              border: "1px solid #333",
            }}
          />

          {comment && (
            <p
              style={{
                color: "#aaa",
                fontSize: 14,
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              {comment}
            </p>
          )}

          <div
            style={{ display: "flex", gap: 8, justifyContent: "center" }}
          >
            <button
              onClick={download}
              style={{
                background: "#1a2a1a",
                border: "1px solid #2a5",
                borderRadius: 10,
                color: "#ededed",
                padding: "10px 18px",
                fontSize: 15,
                cursor: "pointer",
              }}
            >
              💾 Pobierz
            </button>
            <button
              onClick={() => generate(lastPrompt)}
              disabled={loading}
              style={{
                background: "#2a2a3a",
                border: "1px solid #444",
                borderRadius: 10,
                color: "#ededed",
                padding: "10px 18px",
                fontSize: 15,
                cursor: "pointer",
              }}
            >
              🔄 Ponownie
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
