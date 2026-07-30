import type { LanguageModelUsage, UIMessageStreamWriter } from "ai";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Budżet kosztów (Lekcja 10, Warsztat 3) — dzienny limit tokenów per user.
//
//   PRZED wywołaniem LLM  → checkBudget(userId)  — ile user zużył od północy
//   PO   wywołaniu LLM    → logUsage(...)        — dopisz realne zużycie
//
// Limit działa na tokenach, nie na liczbie wiadomości (to robi guard.ts), bo
// płacimy za tokeny: jedno pytanie o raport potrafi kosztować tyle, co sto
// krótkich "cześć". Wymaga migracji supabase/L10_W3_api_usage.sql.

// Warsztat proponuje 10 000, ale sam system prompt Mai + definicje narzędzi to
// ~2,3k tokenów na KAŻDĄ turę (do tego rosnąca historia rozmowy) — przy 10k
// wychodzą ~4 wiadomości dziennie, a jeden raport zjada limit w całości.
// 50k to nadal twardy sufit kosztów, ale starcza na normalną pracę.
export const DAILY_TOKEN_LIMIT = 50_000;

export const BUDGET_MESSAGE = `Dzienny limit tokenów (${DAILY_TOKEN_LIMIT / 1000}k) został wyczerpany. Wróć jutro!`;

// Doba liczona po polsku, nie po UTC: na Vercelu serwer chodzi w UTC, więc bez
// tego licznik resetowałby się o 1:00 albo 2:00 w nocy naszego czasu, a user
// odbity o 23:30 czekałby "do jutra" tylko pół godziny.
const TZ = "Europe/Warsaw";

function startOfToday(): string {
  const now = new Date();
  // Ta sama chwila opisana wskazówkami zegara w Warszawie — różnica względem
  // now to dokładnie tyle, ile minęło od lokalnej północy.
  const local = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  const sinceMidnight =
    local.getHours() * 3_600_000 +
    local.getMinutes() * 60_000 +
    local.getSeconds() * 1_000 +
    now.getMilliseconds();

  return new Date(now.getTime() - sinceMidnight).toISOString();
}

export type BudgetVerdict = { ok: boolean; used: number };

// Ile tokenów user zużył dziś i czy mieści się jeszcze w limicie.
export async function checkBudget(userId?: string): Promise<BudgetVerdict> {
  // Bez tożsamości nie ma komu przypisać budżetu. Czat wymaga logowania (L07),
  // więc w praktyce userId zawsze jest.
  if (!userId) return { ok: true, used: 0 };

  const { data, error } = await supabaseAdmin
    .from("api_usage")
    .select("tokens_input, tokens_output")
    .eq("user_id", userId)
    .gte("created_at", startOfToday());

  if (error) {
    // Fail open: brak tabeli (nieuruchomiona migracja) albo chwilowy błąd bazy
    // nie może zablokować aplikacji wszystkim.
    console.warn("Budżet tokenów nieaktywny — błąd api_usage:", error.message);
    return { ok: true, used: 0 };
  }

  // Wierszy z jednego dnia jest tyle, ile wywołań (dziesiątki) — sumujemy je
  // w JS zamiast pisać RPC z SUM po stronie bazy.
  const rows = (data ?? []) as {
    tokens_input: number | null;
    tokens_output: number | null;
  }[];
  const used = rows.reduce(
    (sum, r) => sum + (r.tokens_input ?? 0) + (r.tokens_output ?? 0),
    0,
  );

  return { ok: used < DAILY_TOKEN_LIMIT, used };
}

// Odmowa wypisana prosto do strumienia UI — dla endpointów, które budują
// odpowiedź przez createUIMessageStream i nie mają czego zwrócić przed jego
// otwarciem. Użytkownik widzi zwykłą wiadomość, a nie błąd sieci.
export function writeBudgetRefusal(writer: UIMessageStreamWriter): void {
  const id = "budget";
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: BUDGET_MESSAGE });
  writer.write({ type: "text-end", id });
}

// Zapis realnego zużycia po odpowiedzi modelu. `usage` z AI SDK sumuje już
// wszystkie kroki agenta (wywołania narzędzi też kosztują tokeny), więc jeden
// wiersz = jedno wywołanie endpointu.
export async function logUsage(entry: {
  userId?: string;
  model: string;
  endpoint: string;
  usage?: LanguageModelUsage;
}): Promise<void> {
  if (!entry.userId) return;

  // Pola bywają puste, gdy dostawca nie zaraportuje zużycia (np. odpowiedź
  // ucięta timeoutem) — wtedy zapisujemy zera, żeby nie zgubić samego faktu
  // wywołania.
  const { error } = await supabaseAdmin.from("api_usage").insert({
    user_id: entry.userId,
    tokens_input: entry.usage?.inputTokens ?? 0,
    tokens_output: entry.usage?.outputTokens ?? 0,
    model: entry.model,
    endpoint: entry.endpoint,
  });

  if (error) {
    // Licznik jest dodatkiem — jego brak nie może przerwać odpowiedzi.
    console.warn("Nie udało się zapisać do api_usage:", error.message);
  }
}
