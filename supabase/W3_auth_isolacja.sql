-- ============================================================================
-- Warsztat 3 — Login i prywatne rozmowy (izolacja danych per user)
-- ============================================================================
-- Uruchom CAŁY ten plik w Supabase → SQL Editor → New query → Run.
-- Kod aplikacji (filtry .eq('user_id', ...) i funkcja match_documents z
-- filter_user_id) ZAKŁADA, że ta migracja została wykonana. Bez niej zapytania
-- z user_id będą zwracać błąd "column user_id does not exist".
--
-- Kolejność jest ważna: najpierw kolumny, potem funkcja, na końcu czyszczenie.

-- ── 1. Kolumny user_id ──────────────────────────────────────────────────────
-- Kto jest właścicielem rozmowy / dokumentu. auth.uid() to id zalogowanego
-- użytkownika z Supabase Auth (ten sam, którego trzyma user_profiles.id).

alter table conversations add column if not exists user_id uuid;
alter table documents     add column if not exists user_id uuid;

-- Indeksy — filtrujemy po user_id przy KAŻDYM odczycie, więc niech baza ma
-- po czym szukać.
create index if not exists conversations_user_id_idx on conversations (user_id);
create index if not exists documents_user_id_idx     on documents (user_id);

-- ── 2. Wyszukiwanie RAG zawężone do usera ───────────────────────────────────
-- Funkcja match_documents (Warsztat 1) szukała po CAŁEJ bazie. Dokładamy
-- parametr filter_user_id: gdy podany → zwraca tylko fragmenty tego usera,
-- gdy NULL → całą bazę (zgodność wstecz). Filtr działa PRZED limitem
-- match_count, więc cudze dokumenty nie wypychają naszych z top-N.
--
-- Najpierw kasujemy starą wersję (3 argumenty), żeby nie powstał niejednoznaczny
-- overload. Jeśli u Ciebie embedding ma inny wymiar niż 768 — dopasuj vector(...).

drop function if exists match_documents(vector, double precision, integer);

create or replace function match_documents (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  filter_user_id uuid default null
)
returns table (
  id uuid,
  title text,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    documents.id,
    documents.title,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where (filter_user_id is null or documents.user_id = filter_user_id)
    and 1 - (documents.embedding <=> query_embedding) > match_threshold
  order by documents.embedding <=> query_embedding
  limit match_count;
$$;

-- ── 3. Czyszczenie starych "sierot" (dane z L05–L06 bez user_id) ────────────
-- Rekordy sprzed logowania nie mają właściciela — nikt ich już nie zobaczy,
-- więc kasujemy. Najpierw wiadomości osieroconych rozmów (gdyby brakowało
-- ON DELETE CASCADE), potem same rozmowy i dokumenty.

delete from messages
where conversation_id in (select id from conversations where user_id is null);

delete from conversations where user_id is null;
delete from documents     where user_id is null;

-- ── 4. (Opcjonalnie) Egzekwowanie na poziomie bazy: NOT NULL ────────────────
-- Po wyczyszczeniu sierot możesz wymusić, by każdy nowy rekord miał właściciela.
-- Odkomentuj, jeśli chcesz twardej gwarancji po stronie bazy:
-- alter table conversations alter column user_id set not null;
-- alter table documents     alter column user_id set not null;

-- ── 5. (Opcjonalnie) Row Level Security ─────────────────────────────────────
-- Aplikacja filtruje po user_id w kodzie. Chcesz twardą izolację nawet gdyby
-- ktoś ominął UI i uderzył prosto w API? Włącz RLS (wymaga, by zapytania szły
-- z tokenem zalogowanego usera):
-- alter table conversations enable row level security;
-- create policy "own conversations" on conversations
--   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- alter table documents enable row level security;
-- create policy "own documents" on documents
--   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
