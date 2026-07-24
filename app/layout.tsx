import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider, AppShell } from "@/app/lib/auth";

export const metadata: Metadata = {
  title: "Mój Agent — centrum dowodzenia AI",
  description:
    "Agent AI z 10 narzędziami: ReAct, asystent podróży, live dashboard z prawdziwymi danymi",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl">
      <body>
        {/* AuthProvider trzyma sesję i pilnuje dostępu; AppShell dobiera layout
            (login bez sidebara, reszta z sidebarem). */}
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
