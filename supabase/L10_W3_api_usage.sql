-- ============================================================================
-- Lekcja 10 — Warsztat 3 — Budżet kosztów (licznik tokenów)
-- ============================================================================
-- Uruchom CAŁY ten plik w Supabase → SQL Editor → New query → Run.
--
-- Tabela api_usage napędza DWIE rzeczy:
--   1. dzienny limit tokenów per user (suma z dzisiejszego dnia) — wartość
--      trzyma DAILY_TOKEN_LIMIT w app/lib/budget.ts, u nas 50 000,
--   2. rachunek sumienia — widać, który endpoint i który model zjada budżet.
--
-- Bez tej migracji aplikacja NIE padnie: app/lib/budget.ts działa wtedy
-- "fail open" — limit się nie egzekwuje (w konsoli pojawi się ostrzeżenie),
-- a rozmowa idzie dalej. Tak samo zachowuje się guard.ts z Warsztatu 2.

-- ── 1. Dziennik zużycia tokenów ─────────────────────────────────────────────
create table if not exists api_usage (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid,                        -- auth.uid() właściciela wywołania
  tokens_input  int  not null default 0,     -- tokeny wysłane do modelu (prompt)
  tokens_output int  not null default 0,     -- tokeny wygenerowane przez model
  model         text,                        -- np. "gemini-3.1-flash-lite"
  endpoint      text                         -- np. "/api/chat", "/api/react"
);

-- Model bywa liczony osobno per krok agenta — jeden wiersz to JEDNO wywołanie
-- LLM (u nas: całe streamText razem z krokami narzędzi, bo SDK sumuje kroki).

-- ── 2. Indeksy ──────────────────────────────────────────────────────────────
-- Zapytanie limitu leci PRZED każdym wywołaniem LLM: "ile tokenów ten user
-- zużył od północy" — bez tego indeksu skanowałoby całą tabelę.
create index if not exists api_usage_user_created_idx
  on api_usage (user_id, created_at desc);

-- ── 3. Row Level Security ───────────────────────────────────────────────────
-- RLS włączone i ZERO polityk = anon key z przeglądarki nic tu nie przeczyta
-- ani nie dopisze. Tabelę zapisuje i czyta wyłącznie serwer kluczem
-- service_role (lib/supabaseAdmin.ts), który omija RLS.
--
-- To celowe: gdyby przeglądarka mogła pisać do api_usage, atakujący kasowałby
-- własne wpisy i limit przestałby cokolwiek znaczyć.
alter table api_usage enable row level security;

-- ── 4. Podgląd zużycia (do wklejenia w SQL Editor) ──────────────────────────
-- Dzisiejsze zużycie per użytkownik:
-- select user_id,
--        sum(tokens_input)  as wejscie,
--        sum(tokens_output) as wyjscie,
--        sum(tokens_input + tokens_output) as razem,
--        count(*) as wywolan
-- from api_usage
-- where created_at >= date_trunc('day', now() at time zone 'Europe/Warsaw')
-- group by user_id
-- order by razem desc;
--
-- Który endpoint zjada najwięcej:
-- select endpoint, model, sum(tokens_input + tokens_output) as razem
-- from api_usage group by endpoint, model order by razem desc;

-- ── 5. Test limitu ──────────────────────────────────────────────────────────
-- Żeby zobaczyć komunikat "Wróć jutro", nie trzeba wyklikać całego limitu:
-- obniż DAILY_TOKEN_LIMIT w app/lib/budget.ts do 100, wyślij dwie wiadomości
-- i przywróć wartość. Reset licznika (kasuje dzisiejsze wpisy usera):
-- delete from api_usage where user_id = 'TWOJE-UUID' and created_at >= current_date;

-- ── 6. (Opcjonalnie) Sprzątanie ─────────────────────────────────────────────
-- Do limitu wystarcza dzisiejszy dzień, do statystyk — kilka tygodni:
-- delete from api_usage where created_at < now() - interval '90 days';
