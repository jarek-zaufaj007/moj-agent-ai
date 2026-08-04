"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// ── Ciemny / jasny motyw (Lekcja 11 / Warsztat 4) ───────────────────────────
// Kolory całej aplikacji siedzą w zmiennych CSS (app/globals.css). Tutaj jest
// tylko przełącznik: ustawia atrybut data-theme na <html> i zapamiętuje wybór
// w localStorage. Pierwsze wejście: motyw z ustawień systemu.

export type Theme = "dark" | "light";

const STORAGE_KEY = "theme";

// Skrypt wstrzykiwany do <head> — ustawia motyw ZANIM przeglądarka cokolwiek
// narysuje. Bez tego przy odświeżeniu strony mignąłby ciemny ekran.
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var saved = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var system = window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
    document.documentElement.dataset.theme = saved === "light" || saved === "dark" ? saved : system;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
`;

type ThemeState = {
  theme: Theme;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeState>({
  theme: "dark",
  toggleTheme: () => {},
});

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start zawsze z "dark", żeby serwer i klient wyrenderowały to samo.
  // Prawdziwą wartość (tę, którą ustawił THEME_INIT_SCRIPT) czytamy po montażu.
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (current === "light" || current === "dark") setTheme(current);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // tryb prywatny / zablokowany storage — motyw zadziała do przeładowania
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Przycisk 🌙 / ☀️ — ten sam komponent w sidebarze i na landing page.
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  const label = dark ? "Włącz jasny motyw" : "Włącz ciemny motyw";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={className ?? "theme-toggle"}
      title={label}
      aria-label={label}
    >
      <span aria-hidden>{dark ? "☀️" : "🌙"}</span>
      <span className="theme-toggle-text">{dark ? "Jasny" : "Ciemny"}</span>
    </button>
  );
}
