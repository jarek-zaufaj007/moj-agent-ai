import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider, AppShell } from "@/app/lib/auth";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/app/lib/theme";
import { InstallPrompt } from "@/app/lib/installPrompt";

// Adres produkcyjny — potrzebny, żeby og:image miał pełny URL (social media
// nie umieją w ścieżki względne). Na Vercelu można nadpisać przez env.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://moj-agent-ai-one.vercel.app";

const TITLE = "Mój Agent — centrum dowodzenia AI";
const DESCRIPTION =
  "Agent AI z bazą wiedzy, pamięcią rozmów i automatyzacją — 20+ narzędzi w jednym panelu.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · Mój Agent",
  },
  description: DESCRIPTION,
  applicationName: "Mój Agent",
  // Po dodaniu do ekranu początkowego iOS ma otworzyć apkę na pełnym ekranie,
  // bez paska adresu, i podpisać ikonę krótką nazwą.
  appleWebApp: {
    capable: true,
    title: "Mój Agent",
    statusBarStyle: "black-translucent",
  },
  // Favicon i ikona na iOS. Pliki leżą w public/ (wygenerowane w Warsztacie 4).
  // Celowo tylko dwa wpisy, w najbardziej ogranej postaci: .ico bez atrybutu
  // sizes (wielowartościowy "16x16 32x32 48x48" bywa źle parsowany przez
  // Safari) plus jeden PNG 32x32. Warianty 192 i 512 są tam, gdzie ich
  // miejsce — w manifeście PWA, nie w <link rel="icon">.
  //
  // ?v=2 to nie ozdobnik: Safari trzyma ikony w cache kluczowanym adresem i
  // pamięta, że kiedyś tej ikony tu nie było. Zmiana adresu zmusza go do
  // pobrania od nowa. Przy kolejnej podmianie rysunku podbij numer.
  icons: {
    icon: [
      { url: "/favicon.ico?v=2" },
      { url: "/icon-32.png?v=2", type: "image/png", sizes: "32x32" },
    ],
    apple: [{ url: "/apple-touch-icon.png?v=2", sizes: "180x180" }],
  },
  // Podgląd linku na LinkedIn / Slack / Twitterze.
  // Sam obrazek generuje app/opengraph-image.tsx.
  openGraph: {
    type: "website",
    locale: "pl_PL",
    url: SITE_URL,
    siteName: "Mój Agent",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  // Kolor paska przeglądarki na telefonie — inny dla każdego motywu.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#f4f6fb" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl" suppressHydrationWarning>
      <head>
        {/* Motyw ustawiany przed pierwszym malowaniem — inaczej przy każdym
            wejściu mignąłby ciemny ekran, zanim React zdąży się zamontować. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {/* ThemeProvider trzyma wybór motywu, AuthProvider sesję,
            a AppShell dobiera layout (login bez sidebara, reszta z sidebarem). */}
        <ThemeProvider>
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
          {/* Pasek „Zainstaluj” — sam się chowa, gdy nie ma czego instalować. */}
          <InstallPrompt />
        </ThemeProvider>
      </body>
    </html>
  );
}
