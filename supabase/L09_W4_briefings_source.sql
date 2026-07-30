-- ============================================================================
-- Lekcja 09 — Warsztat 4 — Kolumna `source` w tabeli briefings
-- ============================================================================
-- Uruchom CAŁY ten plik w Supabase → SQL Editor → New query → Run.
-- WYMAGA wcześniejszego L09_W1_briefings.sql (tworzy samą tabelę).
--
-- PO CO: briefing może powstać na dwa sposoby —
--   • 'cron'   → cron Vercela o 7:00 (endpoint /api/cron/morning, L09 W2),
--   • 'manual' → przycisk "🔄 Wygeneruj teraz" na stronie /briefings.
-- Bez tej kolumny strona pokazywała "wygenerowany automatycznie" nawet przy
-- briefingu klikniętym ręcznie. Teraz karta rozróżnia jedno od drugiego.
--
-- Bezpieczne do powtórnego uruchomienia (if not exists + jawny default).

-- ── Kolumna źródła ──────────────────────────────────────────────────────────
-- default 'cron', bo wszystkie briefingi sprzed tej migracji pochodzą z crona
-- (przycisk ręczny powstał dopiero w W4). Istniejące wiersze dostają 'cron'.
alter table briefings
  add column if not exists source text not null default 'cron';

-- Tylko dwie znane wartości — literówka w kodzie ma paść od razu przy zapisie,
-- a nie po cichu wylądować w bazie jako trzeci, nieobsługiwany status.
alter table briefings
  drop constraint if exists briefings_source_check;
alter table briefings
  add constraint briefings_source_check
  check (source in ('cron', 'manual'));
