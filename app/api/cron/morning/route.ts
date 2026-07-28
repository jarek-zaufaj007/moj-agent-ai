import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { getWeather, getExchangeRate, currentDateTime } from "@/app/lib/tools";
// Cron nie ma zalogowanego usera — piszemy kluczem service_role (omija RLS),
// zamiast polegać na permisywnej polityce anon insert.
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 30;

// Najtańszy model — jeden dla całego projektu (oszczędzanie limitu API).
const MODEL = "gemini-3.1-flash-lite";

// Miasto briefingu — na razie na sztywno (Warszawa), zgodnie z L09 W1.
const CITY = "Warszawa";

// Cron/agent wywołuje narzędzia AI SDK bez pętli modelu, więc odpalamy ich
// execute ręcznie. Drugi argument (ToolCallOptions) implementacje ignorują —
// podajemy atrapę, żeby zgadzała się sygnatura.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toolOpts = { toolCallId: "cron", messages: [] } as any;

// Kształty wyników narzędzi (execute w AI SDK jest typowane jako union z
// AsyncIterable — tu wołamy je zwykłym await, więc zawężamy ręcznie).
type WeatherResult =
  | { temperature: number; humidity: number; windSpeed: number; description: string }
  | { error: string };
type RateResult = { rate: number; date: string } | { error: string };
type DateResult = { datetime: string; iso: string };

// Dzisiejsza data w strefie Europe/Warsaw jako YYYY-MM-DD (kolumna `date`).
function todayISO(): string {
  // en-CA daje format 2026-07-28 — wygodny do zapisu w kolumnie date.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
  }).format(new Date());
}

// Buduje krótki fragment tekstu z wyniku narzędzia (albo komunikat o błędzie),
// żeby wstrzyknąć aktualne dane do promptu AI.
function line(label: string, value: string): string {
  return `${label}: ${value}`;
}

// JSON z jawnym charset=utf-8. Domyślne Response.json() ustawia tylko
// "application/json", przez co przeglądarka zgaduje kodowanie i psuje polskie
// znaki oraz emoji (☀️ → "âď¸"). Jawny UTF-8 wyświetla briefing poprawnie.
function jsonUtf8(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
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

export async function GET(request: Request) {
  // Vercel Cron dokleja nagłówek `Authorization: Bearer $CRON_SECRET`, jeśli
  // zmienna CRON_SECRET jest ustawiona w projekcie. Bez sekretu odrzucamy —
  // celowo NIE porównujemy z `Bearer undefined`, bo wtedy każdy by wszedł.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

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
    console.error("morning: nie udało się wygenerować briefingu.", err);
    return jsonUtf8(
      { success: false, error: "Nie udało się wygenerować briefingu (model niedostępny)." },
      502,
    );
  }

  // 5. Zapisz briefing w Supabase (tabela briefings — patrz L09_W1_briefings.sql).
  const { error: dbError } = await supabaseAdmin
    .from("briefings")
    .insert({ content, date });

  if (dbError) {
    console.error("morning: nie udało się zapisać briefingu.", dbError);
    return jsonUtf8(
      { success: false, error: "Briefing wygenerowany, ale zapis w bazie się nie powiódł." },
      500,
    );
  }

  // 6. Zwróć potwierdzenie z krótkim podglądem.
  return jsonUtf8({
    success: true,
    date,
    preview: content.slice(0, 200),
  });
}
