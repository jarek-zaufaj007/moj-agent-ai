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
import {
  BLOCKED_MESSAGE,
  checkInput,
  checkRateLimit,
  createOutputFilter,
  logMessage,
  sanitizeInput,
} from "@/app/lib/guard";
import { BUDGET_MESSAGE, checkBudget, logUsage } from "@/app/lib/budget";

export const maxDuration = 30;

// Ochrona przed pętlami — twardy limit kroków agenta.
const maxSteps = 3;

// Odpowiedź obronna: agent nic nie generuje, użytkownik dostaje jedno zdanie
// wyjaśnienia w tym samym formacie co zwykła wiadomość.
function refusal(text: string) {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const id = "guard";
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: text });
      writer.write({ type: "text-end", id });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

// Ostatnia wiadomość użytkownika — to ją sprawdza walidacja wejścia.
function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return (last?.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

export async function POST(req: Request) {
  const {
    messages,
    model = "flash",
    userId,
  }: { messages: UIMessage[]; model?: string; userId?: string } =
    await req.json();

  // ── Warstwa 1: walidacja wejścia ──────────────────────────────────────────
  // Zanim cokolwiek pójdzie do modelu (i zanim zapłacimy za tokeny).
  const input = checkInput(lastUserText(messages));
  if (!input.ok) {
    await logMessage({
      userId,
      text: input.text,
      blocked: true,
      reason: input.reason,
    });
    return refusal(BLOCKED_MESSAGE);
  }

  // ── Warstwa 3: limit 50 wiadomości / godzinę per user ─────────────────────
  // Przekroczenia NIE logujemy — inaczej każda odbita próba przesuwałaby okno
  // i limit nigdy by się nie odblokował.
  const rate = await checkRateLimit(userId);
  if (!rate.ok) {
    return refusal(
      `Osiągnąłeś limit wiadomości (50/h). Spróbuj za ${rate.retryInMinutes} min.`,
    );
  }

  // ── Warstwa 4: dzienny budżet tokenów (Warsztat 3) ────────────────────────
  // Limit wiadomości pilnuje CZĘSTOTLIWOŚCI, budżet — KOSZTU. Sprawdzamy go
  // przed wysłaniem czegokolwiek do modelu, bo to tam powstaje rachunek.
  const budget = await checkBudget(userId);
  if (!budget.ok) return refusal(BUDGET_MESSAGE);

  await logMessage({ userId, text: input.text });

  const attempts = modelAttempts(model);

  // Do modelu idzie wersja oczyszczona ze znaków sterujących i zero-width —
  // także w starszych wiadomościach, bo historia rozmowy wraca do modelu przy
  // każdej turze i przemycona tam instrukcja działałaby w nieskończoność.
  const sanitized = messages.map((m) =>
    m.role !== "user"
      ? m
      : {
          ...m,
          parts: m.parts.map((p) =>
            p.type === "text" ? { ...p, text: sanitizeInput(p.text) } : p,
          ),
        },
  );

  const modelMessages = await convertToModelMessages(sanitized);

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
          // Realne zużycie znamy dopiero po odpowiedzi — `usage` sumuje już
          // wszystkie kroki (wywołania narzędzi też kosztują tokeny).
          onFinish: ({ usage }) =>
            void logUsage({
              userId,
              model: modelId,
              endpoint: "/api/chat",
              usage,
            }),
        });

        try {
          // `response` odrzuca się, gdy model zwróci błąd (np. limit / 429)
          // — zanim zaczniemy wysyłać cokolwiek do klienta.
          await result.response;

          // ── Warstwa 2: filtr wyjścia ────────────────────────────────────
          // Odpowiedź modelu przechodzi przez filtr, zanim trafi do
          // przeglądarki. Gdyby model dał się namówić na zdradzenie system
          // promptu albo szczegółów technicznych — urwie się w tym miejscu.
          writer.merge(
            result
              .toUIMessageStream({
                messageMetadata: () => ({ model: modelId }),
              })
              .pipeThrough(
                createOutputFilter((reason) => {
                  console.warn(`Filtr wyjścia zablokował odpowiedź: ${reason}`);
                  void logMessage({
                    userId,
                    text: input.text,
                    blocked: true,
                    reason: `wyciek w odpowiedzi: ${reason}`,
                  });
                }),
              ),
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
