import type { MetadataRoute } from "next";

// Manifest PWA (Lekcja 11 / Warsztat 4).
// Next serwuje ten plik pod /manifest.webmanifest i sam wstawia <link rel="manifest">.
// Efekt: na telefonie „Dodaj do ekranu głównego” daje ikonę jak w natywnej apce,
// a aplikacja startuje bez paska adresu (display: standalone).

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mój Agent — centrum dowodzenia AI",
    short_name: "Mój Agent",
    description:
      "Agent AI z bazą wiedzy, pamięcią rozmów i automatyzacją — 20+ narzędzi w jednym panelu.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    lang: "pl",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Wersja „maskable” — Android przycina ikonę do swojego kształtu,
      // nasz znaczek jest wyśrodkowany, więc przetrwa kadrowanie.
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
