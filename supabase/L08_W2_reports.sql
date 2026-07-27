-- ============================================================================
-- Lekcja 08 — Warsztat 2 — Zapis raportów do bazy (strona /report)
-- ============================================================================
-- Uruchom CAŁY ten plik w Supabase → SQL Editor → New query → Run.
-- Bez tej tabeli przycisk "💾 Zapisz w bazie" na /report zwróci błąd
-- "relation \"reports\" does not exist".
--
-- Wzorzec izolacji per user jest taki sam jak w [[project_auth_izolacja_l07]]:
-- aplikacja filtruje po user_id w kodzie (klient anon key), a user_id to
-- auth.uid() zalogowanego użytkownika.

-- ── 1. Tabela raportów ──────────────────────────────────────────────────────
create table if not exists reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,                       -- właściciel raportu (auth.uid())
  title      text not null,              -- temat raportu (nagłówek na liście)
  content    text not null,              -- pełny markdown raportu
  created_at timestamptz not null default now()
);

-- Filtrujemy i sortujemy listę po user_id — niech baza ma po czym szukać.
create index if not exists reports_user_id_idx on reports (user_id, created_at desc);

-- ── 2. (Opcjonalnie) Row Level Security ─────────────────────────────────────
-- Aplikacja filtruje po user_id w kodzie. Chcesz twardą izolację nawet gdyby
-- ktoś uderzył prosto w API? Włącz RLS (zapytania muszą iść z tokenem usera):
-- alter table reports enable row level security;
-- create policy "own reports" on reports
--   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
