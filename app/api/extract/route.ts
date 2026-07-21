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

// Najtańszy model — jeden dla całego projektu (oszczędzanie limitu API).
const MODELS = ["gemini-3.1-flash-lite"];

// Ochrona przed pętlami — twardy limit kroków agenta.
const maxSteps = 3;

const SYSTEM = `Jesteś Analizatorem — wyciągasz dane USTRUKTURYZOWANE z tekstu lub obrazu (paragon, faktura, wizytówka, ogłoszenie, e-mail, tabela, screenshot).

ZASADY:
- Rozpoznaj typ dokumentu i wyodrębnij WSZYSTKIE istotne pola.
- Nie zmyślaj. Jeśli pola brak — wpisz null (w JSON) lub "—" (w tabeli).
- Kwoty zostaw w oryginalnej walucie; daty w formacie YYYY-MM-DD gdy to możliwe.
- Jeśli obraz jest nieczytelny — powiedz to wprost.

FORMAT ODPOWIEDZI (zawsze markdown, dokładnie w tej kolejności):

## 📋 Typ dokumentu
Jedno zdanie: co to jest.

## 🔑 Dane
Tabela markdown: | Pole | Wartość |. Uwzględnij wszystkie rozpoznane pola.
Dla pozycji/listy (np. produkty na paragonie) zrób osobną tabelę z kolumnami dopasowanymi do treści.

## 🧾 JSON
Blok \`\`\`json z tymi samymi danymi jako czysty, poprawny obiekt JSON (klucze po angielsku, snake_case).

## 💡 Uwagi
Krótko: braki, niepewności, ostrzeżenia (albo "brak").

Język opisu: polski. Bądź zwięzły i precyzyjny.`;

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
