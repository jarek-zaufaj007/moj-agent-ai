-- ============================================================================
-- Lekcja 08 — Warsztat 3 — Zapis analiz konkurencji do bazy (strona /competitor)
-- ============================================================================
-- Uruchom CAŁY ten plik w Supabase → SQL Editor → New query → Run.
-- Bez tej tabeli przycisk "💾 Zapisz w bazie" na /competitor zwróci błąd
-- "relation \"competitor_analyses\" does not exist".
--
-- Osobna tabela od raportów (reports) — analiza konkurencji ma własny widok i
-- listę. Wzorzec izolacji per user jest taki sam jak w [[project_auth_izolacja_l07]]:
-- aplikacja filtruje po user_id w kodzie (klient anon key), a user_id to
-- auth.uid() zalogowanego użytkownika.

-- ── 1. Tabela analiz konkurencji ────────────────────────────────────────────
create table if not exists competitor_analyses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,                       -- właściciel analizy (auth.uid())
  title      text not null,              -- np. "Shopify vs WooCommerce vs PrestaShop"
  companies  text,                       -- porównywane firmy (przecinkami)
  context    text,                       -- opcjonalny kontekst użytkownika
  content    text not null,              -- pełny markdown analizy
  created_at timestamptz not null default now()
);

-- Filtrujemy i sortujemy listę po user_id — niech baza ma po czym szukać.
create index if not exists competitor_analyses_user_id_idx
  on competitor_analyses (user_id, created_at desc);

-- ── 2. Row Level Security ───────────────────────────────────────────────────
-- WAŻNE: jeśli tabela powstała przez Table Editor w Supabase, RLS jest ON
-- domyślnie i BEZ tej polityki insert pada z błędem 42501
-- ("new row violates row-level security policy"). Ta polityka pozwala
-- zalogowanemu użytkownikowi zarządzać WYŁĄCZNIE własnymi analizami — klient
-- aplikacji wysyła token usera, więc auth.uid() = właściciel, a zapis ustawia
-- user_id = user.id (pasuje do with check). To twarda izolacja na poziomie bazy.
alter table competitor_analyses enable row level security;

drop policy if exists "own competitor analyses" on competitor_analyses;
create policy "own competitor analyses" on competitor_analyses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
