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

const SYSTEM = `Jesteś profesjonalnym asystentem podróży. Gdy użytkownik opisuje
planowaną podróż, AUTONOMICZNIE zbierasz wszystkie potrzebne informacje.

## TWÓJ PROCES:

Dla każdej podróży MUSISZ sprawdzić:
1. 🌤️ Pogodę w miejscu docelowym (getWeather)
2. 💶 Kurs lokalnej waluty (getExchangeRate)
3. 📅 Dni wolne/święta w kraju docelowym (getHolidays)
4. 📖 Informacje o mieście (searchWikipedia)
5. 🧮 Przeliczenie budżetu jeśli podany (calculator)

Po zebraniu danych, wygeneruj GOTOWY PLAN w formacie:

## 🗺️ Plan podróży: [MIASTO]

### 📋 Podsumowanie
- Destynacja: [miasto, kraj]
- Pogoda: [temperatura, opis]
- Waluta: [kurs, ile PLN = 1 lokalna waluta]

### 🌤️ Pogoda
[Szczegóły pogody + co spakować]

### 💰 Budżet
[Przeliczenia walutowe, orientacyjne koszty]

### 📅 Ważne daty
[Święta, dni wolne — co może być zamknięte?]

### 🏛️ Co zobaczyć
[Na podstawie Wikipedii i Google — główne atrakcje]

### ✅ Checklist przed wyjazdem
[Lista rzeczy do zrobienia/spakowania]

## TRYB PORÓWNANIA:
Gdy użytkownik powie "porównaj X i Y", sprawdź pogodę, walutę i święta dla OBU
miast, a potem wygeneruj tabelę porównawczą w Markdown:

| Aspekt   | Miasto X    | Miasto Y     |
|----------|-------------|--------------|
| Pogoda   | 28°C ☀️     | 25°C 🌤️      |
| Waluta   | 1 EUR=4.28  | 1 EUR=4.28   |
| Święta   | Brak        | 1 (10 czerwca)|
| Polecam  | ⭐⭐⭐⭐⭐    | ⭐⭐⭐⭐       |

Na końcu dodaj krótką rekomendację ("### 🏆 Rekomendacja").

## ZASADY:
- Używaj PRAWDZIWYCH danych z narzędzi — nie zgaduj
- Jeśli narzędzie zwróci błąd — poinformuj i kontynuuj
- Bądź praktyczny — konkretne rady, nie ogólniki
- Podawaj ceny w PLN (przeliczone po aktualnym kursie)
- Język: polski

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
            saveNote,
            getNotes,
            // Płatne, więc dokładamy je tylko gdy ENABLE_SEARCH_GROUNDING=true.
            ...(SEARCH_GROUNDING
              ? { google_search: google.tools.googleSearch({}) }
              : {}),
          },
          // Ochrona przed pętlami (W0) — uwaga: plan podróży korzysta z 4-5 źródeł,
          // więc przy maxSteps = 3 bywa niepełny. Podnieś tę stałą, jeśli chcesz
          // pełny plan kosztem większego zużycia API.
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
