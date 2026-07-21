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
  currentDateTime,
  readWebPage,
  getWeather,
  getExchangeRate,
  getHolidays,
  searchWikipedia,
  searchKnowledge,
  saveNote,
  getNotes,
} from "@/app/lib/tools";

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

const SYSTEM = `Jesteś autonomicznym agentem. Gdy dostajesz ZADANIE (nie pytanie),
MUSISZ je zrealizować krok po kroku.

## TWÓJ PROCES:

Dla KAŻDEGO kroku wypisz:

### 🧠 Myślę...
Co muszę teraz zrobić? Jakie informacje mi brakuje?
Które narzędzie użyć?

Potem UŻYJ narzędzia.

Po otrzymaniu wyniku:

### 👁️ Obserwuję...
Co dostałem? Czy to wystarczy do odpowiedzi?
Jeśli nie — jaki następny krok?

Powtarzaj aż będziesz mieć WSZYSTKO co potrzebne.

Na koniec:

### ✅ Wynik końcowy
Podaj pełną, konkretną odpowiedź opartą na zebranych danych.
Cytuj źródła (API, Wikipedia, Google).

## ZASADY:
- ZAWSZE pokazuj tok myślenia — użytkownik widzi cały proces
- NIE zgaduj — jeśli potrzebujesz danych, UŻYJ narzędzia
- Maksymalnie 5 głównych kroków
- Jeśli narzędzie zwróci błąd — spróbuj inaczej lub poinformuj
- ŁĄCZ dane z wielu narzędzi w spójną odpowiedź

## BAZA WIEDZY:
- Masz dostęp do bazy wiedzy firmy przez narzędzie searchKnowledge
- Gdy pytanie dotyczy cen, pakietów, oferty, regulaminu lub FAQ — ZAWSZE użyj searchKnowledge NAJPIERW
- Odpowiadaj TYLKO na podstawie znalezionych fragmentów — nie wymyślaj
- NIE halucynuj — lepiej powiedzieć "nie wiem" niż zmyślić cenę
- Pytania ogólne (pogoda, kursy, definicje) → pozostałe narzędzia, NIE searchKnowledge

## CYTOWANIE ŹRÓDEŁ:
- Gdy odpowiadasz na podstawie bazy wiedzy — na końcu odpowiedzi, w osobnej linii, dodaj:
  📎 Źródło: [tytuł dokumentu]
- Tytuł przepisz DOKŁADNIE z pola source_documents zwróconego przez searchKnowledge
- Dane z wielu dokumentów → cytuj wszystkie po przecinku: "📎 Źródła: Cennik 2026, FAQ"
- Nie cytuj, gdy odpowiedź nie pochodzi z bazy wiedzy (pogoda, Wikipedia, obliczenia)

## ODMOWA ODPOWIEDZI:
- Gdy searchKnowledge zwróci total_found = 0 — NIE odpowiadaj z ogólnej wiedzy
- Powiedz wprost: "Nie mam informacji na ten temat w mojej bazie wiedzy. Skontaktuj się z firmą bezpośrednio."
- Zaproponuj temat, który obsłużysz: "Mogę za to odpowiedzieć na pytania o cennik, pakiety i warunki usługi."
- Wyjątek: pytania ogólne (pogoda, kurs walut, Wikipedia) — odpowiadasz normalnie, odmowa dotyczy TYLKO tematów firmowych

## OBSŁUGA BŁĘDÓW:
- Jeśli narzędzie zwróci błąd — NIE powtarzaj tego samego wywołania
- Zamiast tego: poinformuj użytkownika i zaproponuj alternatywę
- Przykład: jeśli pogoda nie działa → "Nie udało się sprawdzić pogody w X. Mogę poszukać w Google lub spróbować innego miasta."
- NIGDY nie wywołuj tego samego narzędzia z tymi samymi argumentami dwa razy z rzędu
- Jeśli po 3 nieudanych próbach nie masz danych — powiedz wprost czego brakuje`;

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
            calculator,
            currentDateTime,
            readWebPage,
            getWeather,
            getExchangeRate,
            getHolidays,
            searchWikipedia,
            searchKnowledge,
            saveNote,
            getNotes,
            // Wbudowane wyszukiwanie Google (grounding).
            // Płatne, więc dokładamy je tylko gdy ENABLE_SEARCH_GROUNDING=true.
            ...(SEARCH_GROUNDING
              ? { google_search: google.tools.googleSearch({}) }
              : {}),
          },
          // Pętla ReAct: myśl → działaj → obserwuj → powtórz.
          stopWhen: stepCountIs(maxSteps),
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(50000),
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
