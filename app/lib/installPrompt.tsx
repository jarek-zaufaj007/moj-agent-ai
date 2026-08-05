"use client";

import { useCallback, useEffect, useState } from "react";

// ── Instalacja aplikacji na telefonie (Lekcja 11 / Warsztat 4) ──────────────
//
// Dwa różne światy, bo przeglądarki się tu nie zgadzają:
//
// 1. Android / Chrome / Edge — system sam proponuje instalację przez zdarzenie
//    beforeinstallprompt. Przechwytujemy je, żeby pokazać własny przycisk
//    w wybranym momencie zamiast czekać na baner przeglądarki.
//
// 2. iOS (Safari i reszta, bo wszystkie używają WebKitu) — beforeinstallprompt
//    NIE ISTNIEJE. Apple nie daje żadnego automatycznego monitu i nie da się go
//    wywołać z kodu. Zostaje pokazanie użytkownikowi, gdzie kliknąć: Udostępnij
//    → „Dodaj do ekranu początkowego". Stąd osobna podpowiedź niżej.

const DISMISS_KEY = "install-hint-dismissed";

// Zdarzenie jest niestandardowe — TypeScript go nie zna.
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS od 13 podaje się za Maca — rozpoznajemy go po ekranie dotykowym.
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

// Aplikacja odpalona z ekranu początkowego — nie ma czego instalować.
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    // Service worker — bez niego Chrome nie uzna apki za instalowalną.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Rejestracja potrafi paść (tryb prywatny, wyłączone SW).
        // To psuje tylko monit o instalację, więc idziemy dalej.
      });
    }

    if (isStandalone()) return;

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // zablokowany storage — pokażemy podpowiedź, trudno
    }
    if (dismissed) return;

    // Android / desktop: łapiemy systemowe zdarzenie i blokujemy własny baner
    // przeglądarki, żeby pokazać swój w wybranym miejscu.
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferred(e as InstallEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS: nie ma czego łapać, po prostu tłumaczymy, gdzie kliknąć.
    if (isIOS()) setShowIosHint(true);

    return () =>
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const dismiss = useCallback(() => {
    setDeferred(null);
    setShowIosHint(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // trudno, pokaże się znowu przy następnej wizycie
    }
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    // Zdarzenia można użyć tylko raz — niezależnie od decyzji chowamy pasek.
    dismiss();
  }, [deferred, dismiss]);

  if (!deferred && !showIosHint) return null;

  return (
    <div className="install-bar" role="complementary">
      <span className="install-icon" aria-hidden>
        📲
      </span>

      {deferred ? (
        <>
          <span className="install-text">
            Zainstaluj Mojego Agenta na telefonie — otworzy się jak zwykła
            aplikacja, bez paska adresu.
          </span>
          <button className="install-btn" onClick={install}>
            Zainstaluj
          </button>
        </>
      ) : (
        <span className="install-text">
          Chcesz ikonę na ekranie początkowym? Stuknij{" "}
          <strong>Udostępnij</strong> na dole Safari, a potem{" "}
          <strong>„Dodaj do ekranu początkowego"</strong>. iPhone nie proponuje
          tego sam — Apple nie daje stronom takiej możliwości.
        </span>
      )}

      <button className="install-close" onClick={dismiss} aria-label="Zamknij">
        ✕
      </button>
    </div>
  );
}
