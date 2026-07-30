-- ============================================================================
-- Lekcja 10 — Warsztat 2 — Obrona wielowarstwowa (dziennik wiadomości)
-- ============================================================================
-- Uruchom CAŁY ten plik w Supabase → SQL Editor → New query → Run.
--
-- Tabela message_logs napędza DWIE rzeczy:
--   1. limit 50 wiadomości / godzinę per user (liczymy wiersze z ostatniej godziny),
--   2. panel bezpieczeństwa z Warsztatu 4 (message_logs WHERE blocked = true).
--
-- Bez tej migracji czat NIE padnie: app/lib/guard.ts działa wtedy "fail open"
-- — limit się nie egzekwuje (w konsoli pojawi się ostrzeżenie), a walidacja
-- wejścia i filtr wyjścia chronią dalej.

-- ── 1. Dziennik wiadomości ──────────────────────────────────────────────────
create table if not exists message_logs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  user_id        uuid,                       -- auth.uid() autora wiadomości
  message_length int  not null default 0,
  blocked        boolean not null default false,
  reason         text,                       -- powód blokady (pusty dla zwykłych)
  excerpt        text                        -- pierwsze 200 znaków — TYLKO dla blocked
);

-- Treść zapisujemy wyłącznie dla wiadomości zablokowanych: normalne rozmowy
-- siedzą już w tabeli messages, a dziennik bezpieczeństwa nie ma być ich kopią.

-- ── 2. Indeksy ──────────────────────────────────────────────────────────────
-- Zapytanie limitu leci przy KAŻDEJ wiadomości: "ile wierszy tego usera z
-- ostatniej godziny" — bez tego indeksu skanowałoby całą tabelę.
create index if not exists message_logs_user_created_idx
  on message_logs (user_id, created_at desc);

-- Panel bezpieczeństwa pyta tylko o zablokowane — indeks częściowy jest mały
-- i szybki, bo pomija zwykły ruch.
create index if not exists message_logs_blocked_idx
  on message_logs (created_at desc)
  where blocked;

-- ── 3. Row Level Security ───────────────────────────────────────────────────
-- RLS włączone i ZERO polityk = anon key z przeglądarki nic tu nie przeczyta
-- ani nie dopisze. Dziennik jest zapisywany i czytany po stronie serwera
-- kluczem service_role (lib/supabaseAdmin.ts), który omija RLS.
--
-- To celowe: gdyby przeglądarka mogła pisać do message_logs, atakujący
-- kasowałby/rozcieńczał własne logi i obchodził limit. Panel z Warsztatu 4
-- musi więc czytać dane przez route handler, nie bezpośrednio z klienta.
alter table message_logs enable row level security;

-- ── 4. (Opcjonalnie) Sprzątanie starych wpisów ──────────────────────────────
-- Do limitu wystarcza ostatnia godzina, do panelu — kilka dni. Raz na jakiś
-- czas możesz przyciąć tabelę:
-- delete from message_logs where created_at < now() - interval '30 days';
