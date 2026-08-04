"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ThemeToggle } from "@/app/lib/theme";

// Strona logowania (Warsztat 3). Jedno wejście do aplikacji: bez zalogowania
// AuthProvider przekierowuje tutaj każdą chronioną trasę. Obsługuje dwa tryby —
// logowanie i rejestrację — na jednym formularzu (przełącznik).

type Mode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isRegister = mode === "register";

  function switchMode() {
    setMode((m) => (m === "login" ? "register" : "login"));
    setError(null);
    setInfo(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const mail = email.trim();
    if (!mail || !password || busy) return;

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      if (isRegister) {
        // Rejestracja nowego konta.
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: mail,
          password,
        });
        if (signUpError) throw signUpError;

        // Gdy w projekcie Supabase wyłączone jest potwierdzanie e-maila,
        // signUp od razu zwraca sesję → wchodzimy prosto do aplikacji.
        if (data.session) {
          router.replace("/");
          return;
        }

        // Bez sesji spróbuj zalogować od razu (potwierdzanie e-maila wyłączone,
        // ale sesja nie przyszła w odpowiedzi na signUp).
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: mail,
          password,
        });
        if (signInError) {
          // Najczęstsza przyczyna: włączone potwierdzanie adresu e-mail.
          setInfo(
            "Konto utworzone. Jeśli projekt wymaga potwierdzenia e-maila, sprawdź skrzynkę, a potem zaloguj się poniżej.",
          );
          setMode("login");
          return;
        }
        router.replace("/");
        return;
      }

      // Logowanie istniejącego konta.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: mail,
        password,
      });
      if (signInError) throw signInError;
      router.replace("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Nie udało się uwierzytelnić.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        position: "relative",
      }}
    >
      {/* Motyw można wybrać jeszcze przed zalogowaniem — sidebar z drugim
          przełącznikiem pojawia się dopiero po wejściu do aplikacji. */}
      <div style={{ position: "absolute", top: 16, right: 16 }}>
        <ThemeToggle className="theme-toggle-lp" />
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "var(--surface-3)",
          border: "1px solid var(--border-soft)",
          borderRadius: 16,
          padding: 28,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 30 }}>🤖</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "8px 0 4px" }}>
            Mój Agent
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
            {isRegister
              ? "Załóż konto, aby zacząć rozmowę"
              : "Zaloguj się, aby kontynuować"}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                color: "var(--muted-strong)",
                marginBottom: 6,
              }}
            >
              E-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              placeholder="jan@test.com"
              style={inputStyle}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                color: "var(--muted-strong)",
                marginBottom: 6,
              }}
            >
              Hasło
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
              minLength={6}
              placeholder="Minimum 6 znaków"
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{ fontSize: 13, color: "#ef4444" }}>❌ {error}</div>
          )}
          {info && (
            <div style={{ fontSize: 13, color: "#22c55e" }}>✅ {info}</div>
          )}

          <button
            type="submit"
            disabled={busy || !email.trim() || !password}
            style={{
              padding: "11px 16px",
              borderRadius: 10,
              border: "none",
              background:
                busy || !email.trim() || !password ? "var(--muted-dim)" : "#2563eb",
              color: "#fff",
              fontSize: 15,
              fontWeight: 600,
              cursor:
                busy || !email.trim() || !password ? "not-allowed" : "pointer",
              marginTop: 4,
            }}
          >
            {busy
              ? "Chwila…"
              : isRegister
                ? "Zarejestruj się"
                : "Zaloguj się"}
          </button>
        </form>

        <div
          style={{
            marginTop: 18,
            textAlign: "center",
            fontSize: 14,
            color: "var(--muted)",
          }}
        >
          {isRegister ? "Masz już konto?" : "Nie masz jeszcze konta?"}{" "}
          <button
            onClick={switchMode}
            style={{
              background: "transparent",
              border: "none",
              color: "#3b82f6",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              padding: 0,
            }}
          >
            {isRegister ? "Zaloguj się" : "Zarejestruj się"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 15,
  outline: "none",
};
