import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { getWeather, getExchangeRate, currentDateTime } from "@/app/lib/tools";
// Briefing powstaje bez zalogowanego usera (cron albo ręczne "Wygeneruj teraz"),
// więc piszemy kluczem service_role (omija RLS) zamiast anon insert.
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Wspólna logika porannego briefingu — używają jej DWA endpointy:
//  • /api/cron/morning        — cron Vercela, chroniony CRON_SECRET (L09 W2),
//  • /api/briefings/generate  — przycisk "🔄 Wygeneruj teraz" na /briefings (L09 W4).
// Dzięki temu prompt i zapis do bazy żyją w jednym miejscu.

// Najtańszy model — jeden dla całego projektu (oszczędzanie limitu API).
const MODEL = "gemini-3.1-flash-lite";

// Miasto briefingu — na razie na sztywno (Warszawa), zgodnie z L09 W1.
const CITY = "Warszawa";

// Narzędzia AI SDK odpalamy ręcznie (bez pętli modelu). Drugi argument
// (ToolCallOptions) implementacje ignorują — podajemy atrapę dla sygnatury.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toolOpts = { toolCallId: "briefing", messages: [] } as any;

// Kształty wyników narzędzi (execute w AI SDK jest typowane jako union z
// AsyncIterable — tu wołamy je zwykłym await, więc zawężamy ręcznie).
type WeatherResult =
  | { temperature: number; humidity: number; windSpeed: number; description: string }
  | { error: string };
type RateResult = { rate: number; date: string } | { error: string };
type DateResult = { datetime: string; iso: string };

export type BriefingResult =
  | { ok: true; date: string; content: string }
  | { ok: false; status: number; error: string };

// Skąd wziął się briefing — kolumna `source` (patrz L09_W4_briefings_source.sql).
// 'cron' = automat o 7:00, 'manual' = przycisk "Wygeneruj teraz" na /briefings.
export type BriefingSource = "cron" | "manual";

// Dzisiejsza data w strefie Europe/Warsaw jako YYYY-MM-DD (kolumna `date`).
// en-CA daje format 2026-07-28 — wygodny do zapisu w kolumnie date.
function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
  }).format(new Date());
}

// Buduje krótki fragment tekstu z wyniku narzędzia (albo komunikat o błędzie),
// żeby wstrzyknąć aktualne dane do promptu AI.
function line(label: string, value: string): string {
  return `${label}: ${value}`;
}

const SYSTEM = `Jesteś osobistym asystentem. Napisz poranny briefing w formacie:

# ☀️ Dzień dobry! Twój briefing na [data]

## 🌤️ Pogoda
[temperatura, opis, co ubrać]

## 💶 Kursy walut
- EUR: [kurs] PLN
- USD: [kurs] PLN

## 📅 Dzisiejszy dzień
- Dzień tygodnia: [...]
- Uwagi: [czy dziś święto? dzień wolny?]

## 💡 Porada dnia
[Krótka, pozytywna porada na dzień]

Pisz po polsku, ciepło i zwięźle. Używaj WYŁĄCZNIE danych podanych poniżej —
nie zmyślaj temperatur ani kursów. Zwróć sam briefing w Markdown, bez komentarzy.`;

/**
 * Zbiera aktualne dane (pogoda, kursy, data), generuje briefing przez AI
 * i zapisuje go w tabeli `briefings`.
 *
 * @param source skąd przyszło żądanie — trafia do kolumny `source`, żeby
 *               strona /briefings odróżniła cron od ręcznego kliknięcia.
 */
export async function generateMorningBriefing(
  source: BriefingSource,
): Promise<BriefingResult> {
  const date = todayISO();

  // 1-3. Zbierz aktualne dane przez narzędzia z L04 (równolegle — niezależne).
  const [weather, eur, usd, now] = (await Promise.all([
    getWeather.execute!({ city: CITY }, toolOpts),
    getExchangeRate.execute!({ currency: "EUR" }, toolOpts),
    getExchangeRate.execute!({ currency: "USD" }, toolOpts),
    currentDateTime.execute!({}, toolOpts),
  ])) as [WeatherResult, RateResult, RateResult, DateResult];

  // Złóż surowe dane w czytelny blok dla modelu.
  const weatherText =
    "error" in weather
      ? `niedostępna (${weather.error})`
      : `${weather.temperature}°C, ${weather.description}, wilgotność ${weather.humidity}%, wiatr ${weather.windSpeed} km/h`;

  const eurText = "error" in eur ? `niedostępny (${eur.error})` : `${eur.rate} PLN`;
  const usdText = "error" in usd ? `niedostępny (${usd.error})` : `${usd.rate} PLN`;
  const dateText = "datetime" in now ? now.datetime : date;

  const dataBlock = [
    line("Miasto", CITY),
    line("Data i godzina", dateText),
    line("Pogoda", weatherText),
    line("Kurs EUR", eurText),
    line("Kurs USD", usdText),
  ].join("\n");

  // 4. Wygeneruj briefing przez AI na podstawie zebranych danych.
  let content: string;
  try {
    const { text } = await generateText({
      model: google(MODEL),
      system: SYSTEM,
      prompt: `Dane na dziś:\n${dataBlock}\n\nNapisz na ich podstawie poranny briefing.`,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(25000),
    });
    content = text.trim();
  } catch (err) {
    console.error("briefing: nie udało się wygenerować briefingu.", err);
    return {
      ok: false,
      status: 502,
      error: "Nie udało się wygenerować briefingu (model niedostępny).",
    };
  }

  // 5. Zapisz briefing w Supabase (tabela briefings — patrz L09_W1_briefings.sql).
  const { error: dbError } = await supabaseAdmin
    .from("briefings")
    .insert({ content, date, source });

  if (dbError) {
    console.error("briefing: nie udało się zapisać briefingu.", dbError);
    // Brak kolumny `source` (PGRST204 z cache'u schematu / 42703 z Postgresa)
    // to najczęstszy błąd po aktualizacji kodu bez odpalenia migracji.
    const missingColumn =
      dbError.code === "PGRST204" || dbError.code === "42703";
    return {
      ok: false,
      status: 500,
      error:
        dbError.code === "42P01"
          ? "Tabela 'briefings' nie istnieje — uruchom supabase/L09_W1_briefings.sql."
          : missingColumn
            ? "Brak kolumny 'source' — uruchom supabase/L09_W4_briefings_source.sql."
            : "Briefing wygenerowany, ale zapis w bazie się nie powiódł.",
    };
  }

  return { ok: true, date, content };
}

// JSON z jawnym charset=utf-8. Domyślne Response.json() ustawia tylko
// "application/json", przez co przeglądarka zgaduje kodowanie i psuje polskie
// znaki oraz emoji (☀️ → "âď¸"). Jawny UTF-8 wyświetla briefing poprawnie.
export function jsonUtf8(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
