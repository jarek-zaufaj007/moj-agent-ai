import { google } from "@ai-sdk/google";
import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  type UIMessage,
} from "ai";
import {
  calculator,
  createProfileTools,
  createSearchKnowledge,
  currentDateTime,
  getExchangeRate,
  getWeather,
  searchWikipedia,
} from "@/app/lib/tools";
import { SYSTEM, buildPersonalization, modelAttempts } from "@/app/lib/persona";

export const maxDuration = 30;

// Ochrona przed pętlami — twardy limit kroków agenta.
const maxSteps = 3;

export async function POST(req: Request) {
  const {
    messages,
    model = "flash",
    userId,
  }: { messages: UIMessage[]; model?: string; userId?: string } =
    await req.json();

  const attempts = modelAttempts(model);

  const modelMessages = await convertToModelMessages(messages);

  // Personalizacja: dołącz dane użytkownika do system promptu i włącz narzędzia
  // zapisujące imię/preferencje do jego profilu.
  const system = SYSTEM + (await buildPersonalization(userId));

  // Baza wiedzy działa dla każdego — narzędzia profilu tylko gdy wiemy, czyj
  // profil aktualizować.
  //
  // Narzędzia do pytań ogólnych muszą tu być, bo system prompt obiecuje je
  // agentowi ("pytania ogólne → pogoda, kursy walut, Wikipedia"). Bez nich model
  // brał obietnicę na słowo i zmyślał odpowiedź (podawał pogodę bez sprawdzenia)
  // — dokładnie ta halucynacja, którą reszta tego warsztatu wycina.
  const tools = {
    // Wyszukiwarka wiedzy zawężona do dokumentów zalogowanego użytkownika.
    searchKnowledge: createSearchKnowledge(userId),
    getWeather,
    getExchangeRate,
    searchWikipedia,
    calculator,
    currentDateTime,
    ...(userId ? createProfileTools(userId) : {}),
  };

  const stream = createUIMessageStream({
    onError: () =>
      "Wszystkie modele są chwilowo niedostępne (możliwy limit API). Spróbuj ponownie za chwilę.",
    execute: async ({ writer }) => {
      let lastError: unknown;

      for (const modelId of attempts) {
        const result = streamText({
          model: google(modelId),
          system,
          messages: modelMessages,
          tools,
          // Pozwól na krok narzędzia (zapis imienia/preferencji, wyszukanie
          // w bazie wiedzy) i kolejny krok z odpowiedzią tekstową.
          stopWhen: stepCountIs(maxSteps),
          // Bez ponawiania + twardy limit czasu, żeby błyskawicznie
          // przejść do modelu zapasowego zamiast czekać na backoff (~40s).
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(20000),
        });

        try {
          // `response` odrzuca się, gdy model zwróci błąd (np. limit / 429)
          // — zanim zaczniemy wysyłać cokolwiek do klienta.
          await result.response;

          writer.merge(
            result.toUIMessageStream({
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
