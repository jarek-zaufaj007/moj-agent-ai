import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/app/lib/nav";

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
        <div className="app-shell">
          <Sidebar />
          <div className="content">{children}</div>
        </div>
      </body>
    </html>
  );
}
