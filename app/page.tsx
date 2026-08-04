"use client";

// Strona "/" ma dwie twarze (Lekcja 11 / Warsztat 1):
// - niezalogowany → landing page (wizytówka produktu z CTA na /login),
// - zalogowany    → dashboard (centrum dowodzenia agenta).
// Sesję rozstrzyga AuthProvider, więc tutaj wystarczy jeden warunek.

import { useAuth } from "@/app/lib/auth";
import { LandingPage } from "@/app/lib/landing";
import DashboardPage from "./dashboard/page";

export default function Home() {
  const { user } = useAuth();
  return user ? <DashboardPage /> : <LandingPage />;
}
