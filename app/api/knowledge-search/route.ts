import { MATCH_THRESHOLD, searchKnowledgeBase } from "@/app/lib/knowledge";

export const maxDuration = 30;

// Podgląd wyszukiwania BEZ agenta — dokładnie ten sam silnik, którego używa
// narzędzie searchKnowledge. Pozwala sprawdzić, czy RAG w ogóle działa, zanim
// zacznie się zgadywać, dlaczego agent odpowiada nie tak, jak trzeba.
//
// Endpoint jest po stronie serwera, bo embedding pytania wymaga klucza API
// Google — ten nigdy nie może trafić do przeglądarki.

// Próg 0 zamiast 0.5: chcemy zobaczyć TAKŻE słabe trafienia. Fragment
// z similarity 0.42 jest niewidzialny dla agenta, ale dla diagnozy bezcenny
// — od razu widać, czy dokumentu brakuje, czy tylko nie dobija do progu.
const PREVIEW_THRESHOLD = 0;
const PREVIEW_COUNT = 8;

export async function POST(req: Request) {
  let query: unknown;
  try {
    const body = await req.json();
    query = body?.query;
  } catch {
    return Response.json({ error: "Nieprawidłowe dane wejściowe." }, { status: 400 });
  }

  if (typeof query !== "string" || !query.trim()) {
    return Response.json({ error: "Podaj pytanie do wyszukania." }, { status: 400 });
  }

  try {
    const search = await searchKnowledgeBase(query, {
      threshold: PREVIEW_THRESHOLD,
      count: PREVIEW_COUNT,
    });

    // agent_threshold jedzie do UI, żeby mogło oznaczyć, które fragmenty
    // faktycznie zobaczyłby agent.
    return Response.json({ ...search, agent_threshold: MATCH_THRESHOLD });
  } catch (err) {
    console.error("knowledge-search error:", err);
    return Response.json(
      { error: "Nie udało się przeszukać bazy wiedzy." },
      { status: 500 },
    );
  }
}
