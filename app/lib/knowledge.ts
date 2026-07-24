import { supabase } from "@/lib/supabase";
import { embedText } from "@/app/lib/embeddings";

// Wyszukiwanie w bazie wiedzy — wspólny silnik dla dwóch odbiorców:
// narzędzia searchKnowledge (agent) i strony /knowledge (podgląd bez agenta).
// Obie strony MUSZĄ liczyć podobieństwo tak samo, inaczej podgląd pokazywałby
// co innego niż widzi agent i przestałby być narzędziem diagnostycznym.

// Próg podobieństwa agenta — poniżej niego fragment uznajemy za niezwiązany
// z pytaniem. To on decyduje o odmowie odpowiedzi ("nie mam tego w bazie").
export const MATCH_THRESHOLD = 0.5;
export const MATCH_COUNT = 5;

// Metadane fragmentu zapisywane przy ingestii (/api/upload-knowledge).
export type KnowledgeMetadata = {
  source?: string;
  chunk_index?: number;
  total_chunks?: number;
};

export type KnowledgeHit = {
  title: string;
  content: string;
  similarity: number;
  metadata: KnowledgeMetadata;
  added_at: string | null; // "2026-07-13" — sama data, bez godziny
};

export type KnowledgeSearch = {
  results: KnowledgeHit[];
  total_found: number;
  source_documents: string[]; // unikalne tytuły — to agent cytuje
  message?: string;
};

// Kształt wiersza zwracanego przez funkcję match_documents (Warsztat 1).
type MatchRow = {
  id: string;
  title: string;
  content: string;
  metadata: KnowledgeMetadata | null;
  similarity: number;
};

type SearchOptions = {
  threshold?: number;
  count?: number;
  // Izolacja danych (Warsztat 3): zawęź wyszukiwanie do dokumentów tego usera.
  // Brak wartości → cała baza (funkcja match_documents traktuje null jako "bez filtra").
  userId?: string;
};

export async function searchKnowledgeBase(
  query: string,
  { threshold = MATCH_THRESHOLD, count = MATCH_COUNT, userId }: SearchOptions = {},
): Promise<KnowledgeSearch> {
  // Typ RETRIEVAL_QUERY (nie DOCUMENT) — Gemini inaczej koduje pytanie,
  // które szuka, niż dokument, który ma zostać znaleziony.
  const embedding = await embedText(query, "RETRIEVAL_QUERY");

  // filter_user_id filtruje po user_id JESZCZE PRZED limitem match_count — inaczej
  // top-N globalne mogłyby wypełnić się cudzymi fragmentami i wypchnąć nasze.
  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: count,
    filter_user_id: userId ?? null,
  });

  if (error) throw new Error(`match_documents: ${error.message}`);

  const rows = (data ?? []) as MatchRow[];

  if (rows.length === 0) {
    return {
      results: [],
      total_found: 0,
      source_documents: [],
      message: "Nie znaleziono informacji w bazie wiedzy.",
    };
  }

  const addedAt = await fetchAddedAt(rows.map((row) => row.id));

  const results: KnowledgeHit[] = rows.map((row) => ({
    title: row.title,
    content: row.content,
    similarity: row.similarity,
    metadata: row.metadata ?? {},
    added_at: addedAt.get(row.id) ?? null,
  }));

  return {
    results,
    total_found: results.length,
    // Set zachowuje kolejność wstawiania, więc pierwszy jest tytuł
    // najlepiej dopasowanego fragmentu.
    source_documents: [...new Set(results.map((r) => r.title))],
  };
}

// match_documents (Warsztat 1) zwraca tylko id/title/content/metadata/similarity
// — daty dodania w nim nie ma. Zamiast kazać zmieniać funkcję SQL w Supabase,
// dobieramy created_at osobnym zapytaniem po id już znalezionych fragmentów.
async function fetchAddedAt(ids: string[]): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, created_at")
    .in("id", ids);

  if (error) {
    // Data dodania to dodatek do cytowania — jej brak nie może wywrócić
    // całego wyszukiwania.
    console.warn("knowledge: nie udało się pobrać dat dodania.", error);
    return new Map();
  }

  return new Map(
    (data ?? []).map((row) => [
      row.id as string,
      String(row.created_at).slice(0, 10),
    ]),
  );
}
