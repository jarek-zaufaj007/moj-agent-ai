import { google } from "@ai-sdk/google";
import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  type UIMessage,
} from "ai";
import { calculator, readWebPage, searchWikipedia } from "@/app/lib/tools";

export const maxDuration = 60;

// Search Grounding jest PŁATNY ($14/1000 zapytań) — domyślnie wyłączony (L03 W1).
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

// Agent pisze raport wieloetapowo: analizuje → szuka → czyta → liczy → pisze.
// Dajemy mu więcej kroków niż zwykłemu czatowi, bo zbiera dane z wielu źródeł.
const maxSteps = 8;

// Dzisiejsza data (Europe/Warsaw) — wstrzykiwana do promptu, żeby agent nie
// zgadywał "aktualnego" roku i poprawnie datował raport.
function todayPL(): string {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "full",
    timeZone: "Europe/Warsaw",
  }).format(new Date());
}

function buildSystem(): string {
  const searchLine = SEARCH_GROUNDING
    ? "- 🔍 google_search — wyszukiwarka Google (grounding) dla AKTUALNYCH danych: wiadomości, ceny, statystyki, trendy, firmy."
    : "- (wyszukiwarka Google jest WYŁĄCZONA. Nie potrafisz samodzielnie przeszukiwać sieci — opieraj się na searchWikipedia oraz readWebPage dla konkretnych URL-i. Nie zmyślaj aktualnych statystyk; zaznacz, gdy danych brakuje.)";

  return `Jesteś profesjonalnym analitykiem biznesowym. Gdy użytkownik poda temat,
AUTONOMICZNIE zbierasz informacje i piszesz raport.

DZISIEJSZA DATA: ${todayPL()}

DOSTĘPNE NARZĘDZIA:
${searchLine}
- 📚 searchWikipedia — definicje, fakty, kontekst historyczny i opisy pojęć.
- 📄 readWebPage — pobiera i czyta całą treść konkretnej strony WWW (URL).
- 🧮 calculator — obliczenia (wzrosty procentowe, udziały rynkowe, przeliczenia).

## TWÓJ PROCES:
1. Przeanalizuj temat — co trzeba zbadać?
2. Szukaj danych: Google Search, Wikipedia, strony branżowe
3. Zbierz fakty, liczby, statystyki
4. Napisz raport w profesjonalnym formacie

## FORMAT RAPORTU:

# 📊 Raport: [TEMAT]
Data: ${todayPL()}
Autor: Agent AI

## Streszczenie (Executive Summary)
[3-4 zdania — kluczowe wnioski]

## 1. Wprowadzenie
[Kontekst, dlaczego ten temat jest ważny]

## 2. Kluczowe dane i fakty
[Wylistowane punkty z danymi — ze źródłami]

## 3. Analiza
[Interpretacja danych, trendy, porównania]

## 4. Wnioski i rekomendacje
[Co z tego wynika? Co robić?]

## Źródła
[Lista użytych źródeł z linkami]

ZASADY:
- Używaj PRAWDZIWYCH danych — Google Search, Wikipedia, strony branżowe.
- Podawaj źródła przy każdym fakcie.
- Bądź konkretny — liczby, daty, nazwy.
- Raport powinien mieć 500-1000 słów.
- Nie wymyślaj statystyk — szukaj!
- Gdy porównujesz opcje (np. technologie, platformy) — użyj tabeli markdown.
- Język: polski.`;
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const modelMessages = await convertToModelMessages(messages);
  const system = buildSystem();

  const stream = createUIMessageStream({
    onError: () =>
      "Wszystkie modele są chwilowo niedostępne (możliwy limit API). Spróbuj ponownie za chwilę.",
    execute: async ({ writer }) => {
      let lastError: unknown;

      for (const modelId of MODELS) {
        const result = streamText({
          model: google(modelId),
          system,
          messages: modelMessages,
          tools: {
            // Wbudowane wyszukiwanie Google (grounding) — nazwa musi brzmieć "google_search".
            // Płatne, więc dokładamy je tylko gdy ENABLE_SEARCH_GROUNDING=true.
            ...(SEARCH_GROUNDING
              ? { google_search: google.tools.googleSearch({}) }
              : {}),
            searchWikipedia,
            readWebPage,
            calculator,
          },
          // Pętla wieloetapowa: analizuj → szukaj → czytaj → licz → pisz raport.
          stopWhen: stepCountIs(maxSteps),
          // Bez ponawiania + limit czasu, żeby szybko przejść do modelu zapasowego.
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(55000),
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
