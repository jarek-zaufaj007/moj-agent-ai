"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { Sidebar } from "@/app/lib/nav";

// ── Logowanie i izolacja danych (Warsztat 3) ────────────────────────────────
// Cała aplikacja jest za loginem. Tu żyje jedno źródło prawdy o użytkowniku:
// - AuthProvider słucha sesji Supabase i przekierowuje niezalogowanych na /login,
// - useAuth() daje każdej stronie dostęp do zalogowanego usera (user.id),
// - AppShell decyduje o layoucie: /login bez sidebara, reszta z sidebarem.

// Ścieżki dostępne bez logowania. Wszystko inne jest chronione.
// "/" jest publiczne, bo niezalogowanemu pokazuje landing page (Lekcja 11),
// a zalogowanemu — dashboard (przełącznik siedzi w app/page.tsx).
const PUBLIC_PATHS = ["/", "/login"];

// Trasy tylko dla gościa: zalogowany nie ma tu czego szukać → wracamy na "/".
const GUEST_ONLY_PATHS = ["/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

function isGuestOnlyPath(pathname: string): boolean {
  return GUEST_ONLY_PATHS.includes(pathname);
}

type AuthState = {
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthState>({ user: null, loading: true });

// Hook dla stron: zwraca zalogowanego użytkownika (albo null, gdy jeszcze
// wczytujemy sesję). Filtrowanie danych per user opiera się na user.id.
export function useAuth(): AuthState {
  return useContext(AuthContext);
}

// Pełnoekranowy spinner na czas sprawdzania sesji i przekierowań.
function FullscreenSpinner({ label }: { label: string }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: "3px solid var(--border)",
          borderTopColor: "#3b82f6",
          borderRadius: "50%",
          animation: "authspin 0.8s linear infinite",
        }}
      />
      <span style={{ color: "var(--muted)", fontSize: 14 }}>{label}</span>
      <style>{"@keyframes authspin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  // Ustal aktualną sesję i nasłuchuj zmian (login / logout / odświeżenie tokenu).
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Strażnik tras: niezalogowany na chronionej trasie → /login,
  // zalogowany na /login → dashboard. Publiczne "/" przepuszczamy w obie strony.
  useEffect(() => {
    if (loading) return;
    if (!user && !isPublicPath(pathname)) {
      router.replace("/login");
    } else if (user && isGuestOnlyPath(pathname)) {
      router.replace("/");
    }
  }, [loading, user, pathname, router]);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

// Powłoka aplikacji — o layoucie decyduje stan logowania:
// - dopóki sprawdzamy sesję → spinner,
// - niezalogowany na trasie publicznej (/, /login) → sama strona, bez sidebara
//   (landing i logowanie mają własny, pełnoekranowy układ),
// - niezalogowany gdzie indziej → spinner (trwa redirect na /login),
// - zalogowany → pełny układ z sidebarem.
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return <FullscreenSpinner label="Sprawdzam sesję…" />;
  }

  if (!user) {
    // Niezalogowany: pokaż stronę publiczną bez powłoki; na chronionej trasie
    // trwa już przekierowanie na /login.
    return isPublicPath(pathname) ? (
      <>{children}</>
    ) : (
      <FullscreenSpinner label="Przekierowuję do logowania…" />
    );
  }

  // Zalogowany, ale na /login → przekierowanie na dashboard w toku.
  if (isGuestOnlyPath(pathname)) {
    return <FullscreenSpinner label="Zalogowano, przekierowuję…" />;
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="content">{children}</div>
    </div>
  );
}
