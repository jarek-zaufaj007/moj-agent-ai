-- ============================================================================
-- Lekcja 08 — Warsztat 4 — Zapis planów posiłków do bazy (strona /meal-planner)
-- ============================================================================
-- Uruchom CAŁY ten plik w Supabase → SQL Editor → New query → Run.
-- Bez tej tabeli przycisk "💾 Zapisz w bazie" na /meal-planner zwróci błąd
-- "relation \"meal_plans\" does not exist".
--
-- Osobna tabela od raportów i analiz konkurencji — planer ma własny widok i
-- listę. Wzorzec izolacji per user jest taki sam jak w [[project_auth_izolacja_l07]]:
-- aplikacja filtruje po user_id w kodzie (klient anon key), a user_id to
-- auth.uid() zalogowanego użytkownika.

-- ── 1. Tabela planów posiłków ───────────────────────────────────────────────
create table if not exists meal_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,                       -- właściciel planu (auth.uid())
  title       text not null,              -- np. "Plan wege, 2 osoby, 2000 kcal"
  preferences text,                       -- preferencje żywieniowe (wejście usera)
  content     text not null,              -- pełny markdown planu
  created_at  timestamptz not null default now()
);

-- Filtrujemy i sortujemy listę po user_id — niech baza ma po czym szukać.
create index if not exists meal_plans_user_id_idx
  on meal_plans (user_id, created_at desc);

-- ── 2. Row Level Security ───────────────────────────────────────────────────
-- WAŻNE: jeśli tabela powstała przez Table Editor w Supabase, RLS jest ON
-- domyślnie i BEZ tej polityki insert pada z błędem 42501
-- ("new row violates row-level security policy"). Ta polityka pozwala
-- zalogowanemu użytkownikowi zarządzać WYŁĄCZNIE własnymi planami — klient
-- aplikacji wysyła token usera, więc auth.uid() = właściciel, a zapis ustawia
-- user_id = user.id (pasuje do with check). To twarda izolacja na poziomie bazy.
alter table meal_plans enable row level security;

drop policy if exists "own meal plans" on meal_plans;
create policy "own meal plans" on meal_plans
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
