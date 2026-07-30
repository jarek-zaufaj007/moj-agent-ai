-- ============================================================================
-- Lekcja 09 — Warsztat 3 — Webhook (endpoint /api/webhook)
-- ============================================================================
-- Uruchom CAŁY ten plik w Supabase → SQL Editor → New query → Run.
-- Bez tej tabeli endpoint /api/webhook padnie przy zapisie z błędem
-- "relation \"webhook_events\" does not exist".
--
-- Tak jak briefingi (L09_W1) webhook leci BEZ zalogowanego użytkownika —
-- request przychodzi z zewnątrz, auth.uid() = NULL. Zapis idzie kluczem
-- service_role (patrz lib/supabaseAdmin.ts), który OMIJA RLS, więc NIE
-- potrzebujemy permisywnej polityki "anon insert".
--
-- RÓŻNICA względem briefings: tu NIE dodajemy polityki publicznego odczytu.
-- Zdarzenia mogą zawierać dane klientów (imię, e-mail, treść reklamacji),
-- więc anon key w przeglądarce ich nie zobaczy. Podglądasz je w Supabase
-- (Table Editor / SQL Editor) — tam działasz jako właściciel projektu.

-- ── 1. Tabela zdarzeń webhooka ──────────────────────────────────────────────
create table if not exists webhook_events (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  type        text not null,              -- feedback / alert / order
  data        jsonb not null,             -- oryginalny payload ze zdarzenia
  analysis    text                        -- analiza agenta (markdown)
);

-- Najnowsze zdarzenia na górze + filtrowanie po typie.
create index if not exists webhook_events_created_at_idx
  on webhook_events (created_at desc);

create index if not exists webhook_events_type_idx
  on webhook_events (type, created_at desc);

-- ── 2. Row Level Security ───────────────────────────────────────────────────
-- RLS włączone i ZERO polityk = nikt z anon/authenticated nie czyta ani nie
-- pisze. Endpoint działa, bo service_role omija RLS.
alter table webhook_events enable row level security;
