import { google } from "@ai-sdk/google";
import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import {
  calculator,
  currentDateTime,
  readWebPage,
  generateImageData,
  createProfileTools,
} from "@/app/lib/tools";
import { buildPersonalization } from "@/app/lib/persona";
import { checkBudget, logUsage, writeBudgetRefusal } from "@/app/lib/budget";

export const maxDuration = 60;

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

const SYSTEM = `Jesteś wszechstronnym agentem AI z zestawem narzędzi. Potrafisz łączyć je w łańcuchy, aby rozwiązać złożone zadania.

DOSTĘPNE NARZĘDZIA:
- 🧮 calculator — obliczenia matematyczne (podatki, marże, przeliczenia).
- 🕐 currentDateTime — aktualna data i godzina (strefa Europe/Warsaw).
${
  SEARCH_GROUNDING
    ? "- 🌐 google_search — wyszukiwarka Google (grounding) dla AKTUALNYCH informacji: wiadomości, ceny, kursy, wyniki, pogoda."
    : "- (wyszukiwarka Google jest WYŁĄCZONA — nie potrafisz samodzielnie przeszukiwać sieci.\n  Gdy potrzebujesz danych z internetu, poproś użytkownika o konkretny URL i przeczytaj go narzędziem readWebPage.)"
}
- 📄 readWebPage — pobiera i czyta całą treść konkretnej strony WWW (URL).
- 🎨 generateImage — generuje obraz na podstawie opisu (prompt). Obraz trafia bezpośrednio do użytkownika.

ZASADY:
- Dobieraj narzędzia do zadania i łącz je (np. wyszukaj cenę → policz podatek; sprawdź datę → policz różnicę dni).
- Gdy korzystasz z internetu — ZAWSZE podawaj źródła (linki).
- Gdy generujesz obraz, po prostu wywołaj generateImage i krótko potwierdź — obraz sam pojawi się w rozmowie. NIE opisuj base64.
- Gdy zadanie nie wymaga narzędzi (żart, prosta wiedza, matematyka w pamięci) — odpowiadaj od razu.
- Bądź konkretny i rzeczowy. Język: polski.`;

export async function POST(req: Request) {
  const { messages, userId }: { messages: UIMessage[]; userId?: string } =
    await req.json();

  const modelMessages = await convertToModelMessages(messages);

  // Personalizacja (Warsztat 4): dokładamy do system promptu dane użytkownika
  // z user_profiles — dzięki temu agent wita po imieniu, a nowego użytkownika
  // sam pyta o imię. Narzędzia profilu (niżej) pozwalają mu to imię zapamiętać.
  const system = SYSTEM + (await buildPersonalization(userId));

  const stream = createUIMessageStream({
    onError: () =>
      "Wszystkie modele są chwilowo niedostępne (możliwy limit API). Spróbuj ponownie za chwilę.",
    execute: async ({ writer }) => {
      // Dzienny budżet tokenów (Warsztat 3) — zanim cokolwiek pójdzie do modelu.
      // Agent multi-tool jest najdroższy: każdy krok narzędzia to osobne
      // wywołanie LLM, a wynik narzędzia wraca do kontekstu.
      const budget = await checkBudget(userId);
      if (!budget.ok) {
        writeBudgetRefusal(writer);
        return;
      }

      // Narzędzie generujące obraz — zdefiniowane w domknięciu, aby mieć dostęp
      // do writera i strumieniować gotowy obraz jako część data-image.
      // Do modelu wraca tylko krótki tekst (bez base64), by nie zapychać kontekstu.
      const generateImage = tool({
        description:
          "Generuje obraz na podstawie opisu (prompt). Używaj gdy użytkownik prosi o grafikę, ilustrację, logo, zdjęcie itp. Obraz pojawi się bezpośrednio w rozmowie.",
        inputSchema: z.object({
          prompt: z
            .string()
            .describe("Szczegółowy opis obrazu do wygenerowania"),
        }),
        execute: async ({ prompt }) => {
          const result = await generateImageData(prompt);
          if ("error" in result) {
            return `Nie udało się wygenerować obrazu: ${result.error}`;
          }
          // Wyślij obraz do klienta osobną częścią danych.
          writer.write({
            type: "data-image",
            id: crypto.randomUUID(),
            data: { image: result.image, prompt },
          });
          return "Obraz został wygenerowany i wyświetlony użytkownikowi.";
        },
      });

      let lastError: unknown;

      for (const modelId of MODELS) {
        const result = streamText({
          model: google(modelId),
          system,
          messages: modelMessages,
          tools: {
            calculator,
            currentDateTime,
            // Wbudowane wyszukiwanie Google (grounding) — nazwa musi brzmieć "google_search".
            // Płatne, więc dokładamy je tylko gdy ENABLE_SEARCH_GROUNDING=true.
            ...(SEARCH_GROUNDING
              ? { google_search: google.tools.googleSearch({}) }
              : {}),
            readWebPage,
            generateImage,
            // Narzędzia profilu — tylko gdy wiemy, czyj profil aktualizować.
            // saveUserName zapamiętuje imię, saveUserPreference — inne fakty.
            ...(userId ? createProfileTools(userId) : {}),
          },
          // Pozwól agentowi na pętlę wielokrokową: szukaj → czytaj → licz → rysuj → odpowiedz.
          stopWhen: stepCountIs(maxSteps),
          // Bez ponawiania + limit czasu, żeby szybko przejść do modelu zapasowego.
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(50000),
          // `usage` sumuje wszystkie kroki pętli agenta — jeden wiersz
          // w api_usage to koszt całej odpowiedzi.
          onFinish: ({ usage }) =>
            void logUsage({
              userId,
              model: modelId,
              endpoint: "/api/agent",
              usage,
            }),
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
