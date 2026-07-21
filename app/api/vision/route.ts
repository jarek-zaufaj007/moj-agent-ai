import { google } from "@ai-sdk/google";
import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  type UIMessage,
} from "ai";

export const maxDuration = 30;

// Gemini Flash Lite obsługuje obrazy natywnie — ten sam model co w czacie.
const MODELS = ["gemini-3.1-flash-lite"];

// Ochrona przed pętlami — twardy limit kroków agenta.
const maxSteps = 3;

const SYSTEM = `Jesteś asystentem Vision — analizujesz obrazy, screenshoty i zdjęcia.

Co potrafisz:
- Opisać co widać na obrazie (obiekty, scena, kontekst).
- Wyciągnąć CAŁY tekst z obrazu (OCR) — zachowaj układ i kolejność.
- Odpowiadać na konkretne pytania o obraz.
- Podać dominujące kolory wraz z kodami HEX.
- Analizować screenshoty błędów/kodu i proponować rozwiązanie.
- Pisać opisy sprzedażowe/marketingowe na podstawie zdjęcia produktu.

Zasady:
- Opieraj się WYŁĄCZNIE na tym, co faktycznie widać — nie zgaduj i nie zmyślaj.
- Jeśli obraz jest nieczytelny lub czegoś nie widać — powiedz to wprost.
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
          stopWhen: stepCountIs(maxSteps),
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(20000),
        });

        try {
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
