import { embedText, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "@/app/lib/embeddings";

export const maxDuration = 30;

// Zamienia tekst na wektor. Wydzielone jako osobny endpoint, bo przydaje się
// do podejrzenia "jak wygląda embedding" — ingestia woła embedText() wprost,
// bez zbędnego przeskoku przez HTTP.
export async function POST(req: Request) {
  let text: string;
  try {
    const body = await req.json();
    text = body?.text;
  } catch {
    return Response.json({ error: "Nieprawidłowe dane wejściowe." }, { status: 400 });
  }

  if (!text || typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "Podaj tekst do zwektoryzowania." }, { status: 400 });
  }

  try {
    const embedding = await embedText(text.trim());
    return Response.json({
      embedding,
      dimensions: embedding.length,
      model: EMBEDDING_MODEL,
    });
  } catch (err) {
    console.error("embed error:", err);
    return Response.json(
      {
        error: `Nie udało się wygenerować embeddingu (model ${EMBEDDING_MODEL}, ${EMBEDDING_DIMENSIONS} wymiarów).`,
      },
      { status: 500 },
    );
  }
}
