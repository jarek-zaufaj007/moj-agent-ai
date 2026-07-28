-- ============================================================================
-- Lekcja 09 — Warsztat 1 — Poranny briefing (endpoint /api/cron/morning)
-- ============================================================================
-- Uruchom CAŁY ten plik w Supabase → SQL Editor → New query → Run.
-- Bez tej tabeli endpoint /api/cron/morning padnie przy zapisie z błędem
-- "relation \"briefings\" does not exist".
--
-- W ODRÓŻNIENIU od tabel per-user (reports, meal_plans, competitor_analyses)
-- briefing generuje CRON, a nie zalogowany użytkownik — request leci bez tokena
-- (auth.uid() = NULL). ZAPIS idzie kluczem service_role (patrz lib/supabaseAdmin.ts),
-- który OMIJA RLS — dlatego NIE potrzebujemy permisywnej polityki "anon insert".
-- Zostawiamy tylko politykę odczytu (strona /briefings z W4 czyta anon key
-- w przeglądarce). user_id zostaje na przyszłość (per-user briefingi), na razie NULL.
--
-- Aktualizacja starej wersji: jeśli wcześniej uruchomiłeś ten plik z polityką
-- "briefings cron insert", ten skrypt ją usunie (drop policy if exists poniżej).

-- ── 1. Tabela briefingów ────────────────────────────────────────────────────
create table if not exists briefings (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  content     text not null,              -- pełna treść briefingu (markdown)
  date        date not null,              -- data briefingu (YYYY-MM-DD)
  user_id     uuid                        -- opcjonalnie, na przyszłość (per user)
);

-- Listę pokazujemy najnowsze na górze — niech baza ma po czym sortować.
create index if not exists briefings_date_idx
  on briefings (date desc, created_at desc);

-- ── 2. Row Level Security ───────────────────────────────────────────────────
-- Zapis robi service_role (omija RLS), więc wystarczy polityka ODCZYTU dla
-- aplikacji (anon). Dane są niewrażliwe (pogoda, kursy, porada dnia).
alter table briefings enable row level security;

drop policy if exists "briefings public read" on briefings;
create policy "briefings public read" on briefings
  for select
  using (true);

-- Stara permisywna polityka zapisu anon — już niepotrzebna (pisze service_role).
drop policy if exists "briefings cron insert" on briefings;
