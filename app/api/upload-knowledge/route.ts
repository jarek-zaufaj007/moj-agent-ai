import { supabase } from "@/lib/supabase";
import { splitIntoChunks } from "@/lib/chunking";
import { embedText } from "@/app/lib/embeddings";

export const maxDuration = 60;

// Ingestia dokumentu: tekst → fragmenty → embeddingi → tabela documents.
// To pierwsza połowa RAG. Druga (wyszukiwanie) przychodzi w Warsztacie 3.
//
// Odpowiedź jest STRUMIENIEM linii JSON (NDJSON), a nie pojedynczym JSON-em:
// embedding każdego fragmentu to osobne wywołanie API, więc dla dłuższego
// dokumentu przeglądarka czekałaby kilkanaście sekund bez żadnego znaku życia.
// Tak zamiast tego wysyłamy postęp fragment po fragmencie.

type Progress =
  | { type: "start"; total: number }
  | { type: "progress"; current: number; total: number }
  | { type: "done"; success: true; chunks_saved: number }
  | { type: "error"; error: string };

export async function POST(req: Request) {
  let title: string;
  let content: string;
  try {
    const body = await req.json();
    title = body?.title;
    content = body?.content;
  } catch {
    return Response.json({ error: "Nieprawidłowe dane wejściowe." }, { status: 400 });
  }

  if (!title || typeof title !== "string" || !title.trim()) {
    return Response.json({ error: "Podaj tytuł dokumentu." }, { status: 400 });
  }
  if (!content || typeof content !== "string" || !content.trim()) {
    return Response.json({ error: "Podaj treść dokumentu." }, { status: 400 });
  }

  const docTitle = title.trim();
  const chunks = splitIntoChunks(content);

  if (chunks.length === 0) {
    return Response.json({ error: "Treść jest pusta po podziale." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Progress) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        send({ type: "start", total: chunks.length });

        let saved = 0;

        // Sekwencyjnie, nie równolegle — Gemini ma limit zapytań na minutę,
        // a równoległe embeddingi całego dokumentu szybko go przekraczają.
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const embedding = await embedText(chunk, "RETRIEVAL_DOCUMENT");

          // created_at pomijamy celowo — kolumna ma DEFAULT now(), więc datę
          // stawia sama baza (jeden zegar dla wszystkich wierszy).
          const { error } = await supabase.from("documents").insert({
            title: docTitle,
            content: chunk,
            embedding,
            metadata: {
              source: docTitle,
              chunk_index: i,
              total_chunks: chunks.length,
            },
          });

          if (error) throw new Error(`Zapis fragmentu ${i + 1}: ${error.message}`);

          saved++;
          send({ type: "progress", current: saved, total: chunks.length });
        }

        send({ type: "done", success: true, chunks_saved: saved });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("upload-knowledge error:", err);
        send({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
