import { createClient } from "@supabase/supabase-js";

// Klient Supabase — połączenie z bazą danych w chmurze.
// Klucze pochodzą z pliku .env.local (NEXT_PUBLIC_* są dostępne w przeglądarce).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
