import { createClient } from "@supabase/supabase-js";

// Klient Supabase z kluczem service_role — pełne uprawnienia, OMIJA RLS.
//
// ⚠️ TYLKO PO STRONIE SERWERA (route handlery, cron). Klucz NIE ma prefiksu
// NEXT_PUBLIC_, więc nie trafia do przeglądarki. Nigdy nie importuj tego pliku
// w komponencie klienckim ("use client") — wyciekłby klucz z pełnym dostępem.
//
// Używany przez endpointy bez zalogowanego użytkownika (np. /api/cron/morning),
// gdzie anon key nie ma tożsamości (auth.uid() = NULL), a mimo to musimy zapisać
// dane. service_role przechodzi obok polityk RLS, więc tabela może mieć twarde
// polityki zamiast permisywnego "anon insert".

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!serviceRoleKey) {
  // Nie rzucamy na imporcie (build by padł) — logujemy, a użycie zwróci błąd.
  console.warn(
    "⚠️ Brak SUPABASE_SERVICE_ROLE_KEY w .env.local — endpointy serwerowe " +
      "(np. /api/cron/morning) nie zapiszą danych z pominięciem RLS.",
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey ?? "", {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
