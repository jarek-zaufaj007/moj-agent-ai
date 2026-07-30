import { google } from "@ai-sdk/google";
import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  type UIMessage,
} from "ai";
import { readWebPage, searchWikipedia } from "@/app/lib/tools";
import { checkBudget, logUsage, writeBudgetRefusal } from "@/app/lib/budget";

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

// Analiza konkurencji jest wieloetapowa: dla KAŻDEJ z 3 firm agent szuka,
// czyta strony i porównuje. Dajemy więcej kroków niż zwykłemu czatowi.
const maxSteps = 10;

// Dzisiejsza data (Europe/Warsaw) — wstrzykiwana do promptu, żeby agent nie
// zgadywał "aktualnego" roku i poprawnie datował dane.
function todayPL(): string {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "full",
    timeZone: "Europe/Warsaw",
  }).format(new Date());
}

function buildSystem(): string {
  const searchLine = SEARCH_GROUNDING
    ? "- 🔍 google_search — wyszukiwarka Google (grounding) dla AKTUALNYCH danych: ceny, produkty, wielkość firm, opinie."
    : "- (wyszukiwarka Google jest WYŁĄCZONA. Nie potrafisz samodzielnie przeszukiwać sieci — opieraj się na searchWikipedia oraz readWebPage dla konkretnych URL-i. Nie zmyślaj cen ani statystyk; zaznacz, gdy danych brakuje.)";

  return `Jesteś analitykiem konkurencji. Gdy użytkownik poda nazwy firm,
AUTONOMICZNIE zbierasz informacje i porównujesz je.

DZISIEJSZA DATA: ${todayPL()}

DOSTĘPNE NARZĘDZIA:
${searchLine}
- 📚 searchWikipedia — definicje, fakty, opis firmy, branża, historia.
- 📄 readWebPage — pobiera i czyta całą treść konkretnej strony WWW (URL, np. strona firmowa lub cennik).

## TWÓJ PROCES:
1. Dla KAŻDEJ firmy: szukaj informacji (Google, Wikipedia, strony firmowe)
2. Zbierz: opis, branża, wielkość, produkty, ceny, mocne/słabe strony
3. Stwórz tabelę porównawczą
4. Napisz rekomendację

## FORMAT:

# 🏢 Analiza konkurencji

## Porównanie

| Aspekt | [Firma 1] | [Firma 2] | [Firma 3] |
|--------|-----------|-----------|-----------|
| Branża | ... | ... | ... |
| Wielkość | ... | ... | ... |
| Główny produkt | ... | ... | ... |
| Mocne strony | ... | ... | ... |
| Słabe strony | ... | ... | ... |
| Ceny (orientacyjne) | ... | ... | ... |

## Szczegółowa analiza
[Rozwinięcie dla każdej firmy — 3-4 zdania]

## Rekomendacja
[Która firma jest najlepsza i dlaczego — w kontekście użytkownika]

## Źródła
[Ponumerowana lista WSZYSTKICH źródeł z jawnymi linkami (pełne URL-e), z których
faktycznie korzystałeś — każdy adres strony, którą otworzyłeś przez readWebPage,
oraz artykuł/hasło Wikipedii. Format: "1. Nazwa — https://pełny-adres".]

ZASADY:
- Używaj PRAWDZIWYCH danych — Google Search, Wikipedia, strony firmowe.
- Podawaj źródła przy faktach.
- KONIECZNIE zawsze kończ odpowiedź sekcją "## Źródła" z listą jawnych linków
  (pełnych URL-i) do każdego źródła, z którego korzystałeś. Nie pomijaj tej sekcji.
  Jeśli korzystałeś z jakiegoś źródła — link do niego MUSI znaleźć się na końcu.
- Bądź konkretny — liczby, ceny, nazwy produktów.
- Nie wymyślaj cen ani statystyk — szukaj! Gdy danych brak, napisz "brak danych".
- Jeśli użytkownik poda kontekst (np. "szukam platformy dla małego sklepu"),
  dostosuj rekomendację do tego kontekstu.
- Język: polski.`;
}

export async function POST(req: Request) {
  const { messages, userId }: { messages: UIMessage[]; userId?: string } =
    await req.json();

  const modelMessages = await convertToModelMessages(messages);
  const system = buildSystem();

  const stream = createUIMessageStream({
    onError: () =>
      "Wszystkie modele są chwilowo niedostępne (możliwy limit API). Spróbuj ponownie za chwilę.",
    execute: async ({ writer }) => {
      // Dzienny budżet tokenów (Warsztat 3).
      const budget = await checkBudget(userId);
      if (!budget.ok) {
        writeBudgetRefusal(writer);
        return;
      }

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
          },
          // Pętla wieloetapowa: dla każdej firmy szukaj → czytaj → porównuj → rekomenduj.
          stopWhen: stepCountIs(maxSteps),
          // Bez ponawiania + limit czasu, żeby szybko przejść do modelu zapasowego.
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(55000),
          onFinish: ({ usage }) =>
            void logUsage({
              userId,
              model: modelId,
              endpoint: "/api/competitor",
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
