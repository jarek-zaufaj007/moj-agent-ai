import { google } from "@ai-sdk/google";
import { embed } from "ai";

// Embeddingi — zamiana tekstu na "adres znaczeniowy" (wektor liczb).
// Współdzielone przez ingestię (/api/upload-knowledge) i wyszukiwanie,
// bo OBIE strony muszą używać tego samego modelu i tej samej liczby wymiarów.
// Wektor pytania i wektor dokumentu z różnych modeli są nieporównywalne.

// Materiały kursu mówią o "text-embedding-004", ale ten model nie istnieje już
// w API Gemini (404 — nie ma go na liście ListModels). Aktualny odpowiednik to
// gemini-embedding-001.
export const EMBEDDING_MODEL = "gemini-embedding-001";

// Kolumna w Supabase to vector(768) (z Warsztatu 1), więc prosimy API dokładnie
// o 768 wymiarów. gemini-embedding-001 domyślnie zwraca 3072 — bez tego ustawienia
// każdy INSERT odbiłby się o niezgodność wymiarów.
export const EMBEDDING_DIMENSIONS = 768;

// Do czego służy dany wektor. Gemini inaczej koduje dokument (który ma być
// znaleziony), a inaczej pytanie (które szuka) — użycie właściwego typu
// zauważalnie poprawia trafność wyszukiwania.
export type EmbeddingTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

// Skrócenie wektora z 3072 do 768 wymiarów (technika MRL) psuje jego długość —
// API zwraca wtedy wektor o normie ~0.58 zamiast 1.0. Google zaleca ponowną
// normalizację dla każdego rozmiaru innego niż 3072.
function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm > 0 ? vector.map((x) => x / norm) : vector;
}

export async function embedText(
  text: string,
  taskType: EmbeddingTask = "RETRIEVAL_DOCUMENT",
): Promise<number[]> {
  const { embedding } = await embed({
    model: google.textEmbedding(EMBEDDING_MODEL),
    value: text,
    providerOptions: {
      google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType },
    },
    maxRetries: 2,
  });

  return normalize(embedding);
}
