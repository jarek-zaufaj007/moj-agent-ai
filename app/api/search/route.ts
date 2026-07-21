import { google } from "@ai-sdk/google";
import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  type UIMessage,
} from "ai";
import { readWebPage } from "@/app/lib/tools";

export const maxDuration = 30;

// Search Grounding jest PŁATNY ($14/1000 zapytań) — domyślnie wyłączony.
// Włącz tylko na czas testów: ENABLE_SEARCH_GROUNDING=true w .env.local.
const SEARCH_GROUNDING = process.env.ENABLE_SEARCH_GROUNDING === "true";

if (process.env.ENABLE_SEARCH_GROUNDING === "true") {
  console.warn(
    "⚠️ UWAGA: Search Grounding jest WŁĄCZONY. " +
      "To jest najdroższa funkcja API ($14/1000 zapytań). " +
      "Używaj TYLKO do testów. Wyłącz po testach usuwając ENABLE_SEARCH_GROUNDING z .env.local, " +
      "bo inni uczestnicy kursu mają wtedy ograniczony dostęp do modeli.",
  );
}

// Najtańszy model — jeden dla całego projektu (oszczędzanie limitu API).
const MODELS = ["gemini-3.1-flash-lite"];

// Ochrona przed pętlami — twardy limit kroków agenta.
const maxSteps = 3;

const SYSTEM = `Jesteś asystentem z DOSTĘPEM DO INTERNETU. ${
  SEARCH_GROUNDING
    ? `Masz dwa źródła aktualnych danych:

1. 🔍 Wyszukiwarka Google (grounding) — używaj gdy pytanie dotyczy AKTUALNYCH informacji:
   najnowsze wiadomości, ceny, kursy walut, wyniki meczów, pogoda, wydarzenia, repertuar kin itp.
2. 📄 Narzędzie readWebPage — używaj gdy użytkownik poda konkretny URL LUB gdy chcesz
   przeczytać w całości artykuł/stronę znalezioną w wyszukiwarce.`
    : `Masz JEDNO źródło aktualnych danych:

1. 📄 Narzędzie readWebPage — pobiera i czyta całą treść konkretnej strony WWW (URL).

Wyszukiwarka Google jest WYŁĄCZONA — nie potrafisz samodzielnie przeszukiwać sieci.
Gdy użytkownik poda URL — przeczytaj go narzędziem readWebPage.
Gdy pyta o aktualne informacje bez podania źródła — powiedz wprost, że wyszukiwarka
jest wyłączona, i poproś o konkretny link. NIE zmyślaj aktualnych danych.`
}

ZASADY:
- Gdy korzystasz z internetu — ZAWSZE podawaj źródła (linki), z których pochodzą informacje.
- Gdy pytanie NIE wymaga internetu (np. żart, prosta wiedza ogólna, matematyka) — odpowiadaj od razu, bez wyszukiwania.
- Wyraźnie rozdzielaj fakty pochodzące z internetu od Twojej własnej wiedzy.
- Bądź konkretny i rzeczowy. Język: polski.`;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const modelMessages = await convertToModelMessages(messages);

  const stream = createUIMessageStream({
    onError: () =>
      "Wszystkie modele są chwilowo niedostępne (możliwy limit API). Spróbuj ponownie za chwilę.",
    execute: async ({ writer }) => {
      let lastError: unknown;

      for (const modelId of MODELS) {
        const result = streamText({
          model: google(modelId),
          system: SYSTEM,
          messages: modelMessages,
          tools: {
            // Wbudowane wyszukiwanie Google (grounding) — nazwa musi brzmieć "google_search".
            // Płatne, więc dokładamy je tylko gdy ENABLE_SEARCH_GROUNDING=true.
            ...(SEARCH_GROUNDING
              ? { google_search: google.tools.googleSearch({}) }
              : {}),
            readWebPage,
          },
          // Pozwól agentowi na pętlę: szukaj → czytaj stronę → odpowiedz.
          stopWhen: stepCountIs(maxSteps),
          // Bez ponawiania + limit czasu, żeby szybko przejść do modelu zapasowego.
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(20000),
        });

        try {
          await result.response;

          writer.merge(
            result.toUIMessageStream({
              sendSources: true,
              messageMetadata: () => ({ model: modelId }),
            }),
          );
          return;
        } catch (err) {
          lastError = err;
          console.warn(`Model ${modelId} niedostępny, próbuję dalej.`);
        }
      }

      throw lastError ?? new Error("Brak dostępnych modeli.");
    },
  });

  return createUIMessageStreamResponse({ stream });
}
