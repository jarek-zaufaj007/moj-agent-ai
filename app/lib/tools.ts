import { GoogleGenAI, Modality } from "@google/genai";
import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { canonicalFactKey } from "@/app/lib/persona";
import { searchKnowledgeBase } from "@/app/lib/knowledge";

// ── Wspólny fetch z timeoutem 5s ────────────────────────────────────────────
// Rzuca Error("timeout") gdy serwer nie odpowie w 5s, żeby narzędzia mogły
// zwrócić czytelny komunikat zamiast się zawieszać.
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = 5000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("timeout");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Zamień wyjątek fetch na czytelny komunikat błędu.
function networkErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message === "timeout") {
    return "Timeout — serwer nie odpowiedział w 5 sekund. Spróbuj ponownie.";
  }
  return fallback;
}

// ── Kalkulator ──────────────────────────────────────────────────────────────
// Bezpieczny parser (recursive descent) — BEZ eval/Function.
function evalMath(input: string): number {
  const s = input.replace(/\s+/g, "").replace(/,/g, ".");
  let i = 0;
  const peek = () => s[i];

  function parseExpr(): number {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = s[i++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = s[i++];
      const r = parseFactor();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }
  function parseFactor(): number {
    if (peek() === "+") {
      i++;
      return parseFactor();
    }
    if (peek() === "-") {
      i++;
      return -parseFactor();
    }
    if (peek() === "(") {
      i++;
      const v = parseExpr();
      if (peek() !== ")") throw new Error("brak nawiasu zamykającego");
      i++;
      return v;
    }
    return parseNumber();
  }
  function parseNumber(): number {
    const start = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    if (i === start) throw new Error("oczekiwano liczby");
    const n = Number(s.slice(start, i));
    if (!Number.isFinite(n)) throw new Error("nieprawidłowa liczba");
    return n;
  }

  const result = parseExpr();
  if (i !== s.length) throw new Error("nieoczekiwany znak");
  if (!Number.isFinite(result)) throw new Error("wynik poza zakresem");
  return result;
}

export const calculator = tool({
  description:
    "Wykonuje obliczenia matematyczne. Podaj wyrażenie, np. '8500 * 0.23' albo '(100+50)/3'. Obsługuje + - * / % i nawiasy.",
  inputSchema: z.object({
    expression: z.string().describe("Wyrażenie matematyczne do obliczenia"),
  }),
  execute: async ({ expression }) => {
    // Walidacja bezpieczeństwa — odrzuć próby wstrzyknięcia kodu.
    if (/import|require|eval|process|fetch|constructor|=>|`/.test(expression)) {
      return { expression, error: "Wyrażenie zawiera niedozwolone znaki." };
    }
    try {
      return { expression, result: evalMath(expression) };
    } catch {
      return { expression, error: `Nie mogę obliczyć: ${expression}` };
    }
  },
});

// ── Data i czas ─────────────────────────────────────────────────────────────
export const currentDateTime = tool({
  description:
    "Zwraca aktualną datę i godzinę (strefa Europe/Warsaw). Używaj gdy pytanie dotyczy 'dziś', 'teraz', 'która godzina', dnia tygodnia itp.",
  inputSchema: z.object({}),
  execute: async () => {
    const now = new Date();
    const datetime = new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Europe/Warsaw",
    }).format(now);
    return { datetime, iso: now.toISOString() };
  },
});

// ── Czytanie stron WWW ──────────────────────────────────────────────────────
export const readWebPage = tool({
  description:
    "Pobiera i czyta zawartość strony internetowej. Używaj gdy użytkownik poda URL lub gdy chcesz przeczytać artykuł/stronę znalezioną w wyszukiwarce.",
  inputSchema: z.object({
    url: z.string().describe("Pełny adres URL strony do przeczytania"),
  }),
  execute: async ({ url }) => {
    try {
      const res = await fetchWithTimeout(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; MojAgent/1.0; +https://example.com/bot)",
        },
      });
      if (!res.ok) {
        return `Nie udało się pobrać strony — serwer zwrócił status HTTP ${res.status}. Spróbuj innego adresu.`;
      }
      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) return "Strona nie zawiera czytelnego tekstu.";
      return text.slice(0, 3000);
    } catch (err) {
      if (err instanceof Error && err.message === "timeout") {
        return "Strona nie odpowiedziała w ciągu 5 sekund (timeout).";
      }
      return "Nie udało się otworzyć strony (błąd sieci lub niedostępny adres).";
    }
  },
});

// ── Pogoda (Open-Meteo, darmowe, bez klucza) ────────────────────────────────
export const getWeather = tool({
  description:
    "Sprawdza aktualną pogodę w podanym mieście (temperatura, wilgotność, wiatr). Używaj gdy pytanie dotyczy pogody.",
  inputSchema: z.object({
    city: z.string().describe("Nazwa miasta, np. 'Warszawa'"),
  }),
  execute: async ({ city }) => {
    if (!city || !city.trim()) return { error: "Podaj nazwę miasta." };
    try {
      const geoRes = await fetchWithTimeout(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          city,
        )}&count=1&language=pl`,
      );
      if (!geoRes.ok) {
        return { error: `API geolokalizacji zwróciło błąd ${geoRes.status}. Spróbuj ponownie.` };
      }
      const geo = await geoRes.json();
      const place = geo?.results?.[0];
      if (!place) {
        return { error: `Nie znalazłem miasta "${city}". Sprawdź pisownię.` };
      }

      const { latitude, longitude, name } = place;
      const wRes = await fetchWithTimeout(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`,
      );
      if (!wRes.ok) {
        return { error: `Serwer pogodowy zwrócił błąd ${wRes.status}. Spróbuj ponownie.` };
      }
      const w = await wRes.json();
      const c = w?.current;
      if (!c) return { error: `Nie udało się pobrać pogody dla "${name}".` };

      return {
        city: name,
        temperature: c.temperature_2m,
        humidity: c.relative_humidity_2m,
        windSpeed: c.wind_speed_10m,
        description: weatherCodeToText(c.weather_code),
      };
    } catch (err) {
      return {
        error: networkErrorMessage(
          err,
          `Nie udało się sprawdzić pogody dla "${city}" (błąd połączenia).`,
        ),
      };
    }
  },
});

// Mapowanie kodów pogody WMO na krótki opis po polsku.
function weatherCodeToText(code: number): string {
  const map: Record<number, string> = {
    0: "bezchmurnie",
    1: "głównie bezchmurnie",
    2: "częściowe zachmurzenie",
    3: "pochmurno",
    45: "mgła",
    48: "osadzająca się mgła",
    51: "mżawka słaba",
    53: "mżawka",
    55: "mżawka silna",
    61: "deszcz słaby",
    63: "deszcz",
    65: "deszcz silny",
    71: "śnieg słaby",
    73: "śnieg",
    75: "śnieg silny",
    80: "przelotne opady",
    81: "przelotne opady",
    82: "ulewne opady",
    95: "burza",
    96: "burza z gradem",
    99: "burza z gradem",
  };
  return map[code] ?? "brak danych";
}

// ── Kurs waluty (NBP, darmowe, bez klucza) ──────────────────────────────────
export const getExchangeRate = tool({
  description:
    "Sprawdza kurs waluty do PLN z Narodowego Banku Polskiego. Używaj do przeliczeń walutowych.",
  inputSchema: z.object({
    currency: z
      .string()
      .describe("Kod waluty, np. 'EUR', 'USD', 'GBP', 'CHF'"),
  }),
  execute: async ({ currency }) => {
    const code = (currency ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      return { error: "Podaj 3-literowy kod waluty (np. EUR, USD)." };
    }
    try {
      const res = await fetchWithTimeout(
        `https://api.nbp.pl/api/exchangerates/rates/a/${code}/?format=json`,
      );
      if (res.status === 404) {
        return {
          error: `Waluta ${code} nie jest w tabeli NBP. Popularne: EUR, USD, GBP, CHF`,
        };
      }
      if (!res.ok) {
        return { error: `API NBP zwróciło błąd ${res.status}. Sprawdź parametry.` };
      }
      const data = await res.json();
      const rate = data?.rates?.[0];
      return {
        currency: code,
        rate: rate?.mid,
        date: rate?.effectiveDate,
        source: "NBP",
      };
    } catch (err) {
      return {
        error: networkErrorMessage(err, `Nie udało się pobrać kursu ${code} (błąd połączenia).`),
      };
    }
  },
});

// ── Najważniejsze wiadomości (Google News RSS, darmowe, bez klucza) ─────────
// Zamiana encji HTML na znaki — tytuły w RSS przychodzą jako "Tusk &quot;X&quot;".
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // na końcu, inaczej rozbiłoby powyższe
}

export const getTopNews = tool({
  description:
    "Pobiera najważniejsze wiadomości dnia z Google News (polskie wydanie). Używaj do pytań o aktualne newsy, co się dzieje w kraju i na świecie.",
  inputSchema: z.object({
    limit: z
      .number()
      .optional()
      .describe("Ile nagłówków zwrócić (domyślnie 5, maksymalnie 10)"),
  }),
  execute: async ({ limit }) => {
    const count = Math.min(Math.max(limit ?? 5, 1), 10);
    try {
      const res = await fetchWithTimeout(
        "https://news.google.com/rss?hl=pl&gl=PL&ceid=PL:pl",
        // Bez User-Agenta Google potrafi oddać pustą odpowiedź.
        { headers: { "user-agent": "Mozilla/5.0 (compatible; moj-agent/1.0)" } },
      );
      if (!res.ok) {
        return { error: `Google News zwróciło błąd ${res.status}.` };
      }
      const xml = await res.text();

      // Prosty parser RSS regexem — feed ma płaską, stałą strukturę
      // <item><title>…</title><link>…</link>, więc nie wciągamy zależności XML.
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
        .map((m) => {
          const title = m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
          const url = m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "";
          // Google News składa tytuł jako "Nagłówek - Źródło" — rozdzielamy po
          // OSTATNIM " - ", bo sam nagłówek często zawiera myślniki.
          const clean = decodeEntities(title).trim();
          const cut = clean.lastIndexOf(" - ");
          return {
            title: cut > 0 ? clean.slice(0, cut) : clean,
            source: cut > 0 ? clean.slice(cut + 3) : "Google News",
            url: decodeEntities(url).trim(),
          };
        })
        .filter((n) => n.title && n.url)
        .slice(0, count);

      if (items.length === 0) {
        return { error: "Google News nie zwróciło żadnych wiadomości." };
      }
      return { news: items, source: "Google News" };
    } catch (err) {
      return {
        error: networkErrorMessage(
          err,
          "Nie udało się pobrać wiadomości (błąd połączenia).",
        ),
      };
    }
  },
});

// ── Święta państwowe (Nager.Date, darmowe, bez klucza) ──────────────────────
export const getHolidays = tool({
  description:
    "Sprawdza święta państwowe w danym kraju na dany rok. Używaj do pytań o dni wolne, święta.",
  inputSchema: z.object({
    countryCode: z.string().describe("Kod kraju ISO, np. 'PL', 'DE', 'US'"),
    year: z.number().describe("Rok, np. 2026"),
  }),
  execute: async ({ countryCode, year }) => {
    const code = (countryCode ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) {
      return { error: "Podaj 2-literowy kod kraju (np. PL, DE, US)." };
    }
    try {
      const res = await fetchWithTimeout(
        `https://date.nager.at/api/v3/publicholidays/${year}/${code}`,
      );
      if (!res.ok) {
        return {
          error: `Nie znalazłem świąt dla kraju ${code}. Popularne: PL, DE, US, GB, FR`,
        };
      }
      const list = (await res.json()) as Array<{
        date: string;
        localName: string;
        name: string;
      }>;
      return {
        countryCode: code,
        year,
        holidays: list.slice(0, 15).map((h) => ({
          date: h.date,
          localName: h.localName,
          name: h.name,
        })),
      };
    } catch (err) {
      return {
        error: networkErrorMessage(err, `Nie udało się pobrać świąt dla kraju ${code} (błąd połączenia).`),
      };
    }
  },
});

// ── Wikipedia (darmowe, bez klucza) ─────────────────────────────────────────
export const searchWikipedia = tool({
  description:
    "Wyszukuje artykuł w polskiej Wikipedii i zwraca streszczenie. Używaj do definicji, faktów, opisów miejsc i pojęć.",
  inputSchema: z.object({
    query: z.string().describe("Hasło do wyszukania, np. 'sztuczna inteligencja'"),
  }),
  execute: async ({ query }) => {
    if (!query || !query.trim()) return { error: "Podaj hasło do wyszukania." };
    try {
      const res = await fetchWithTimeout(
        `https://pl.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          query,
        )}`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.extract) {
          return {
            title: data.title,
            summary: String(data.extract).slice(0, 1000),
            url: data?.content_urls?.desktop?.page,
          };
        }
      }

      // Fallback: pełnotekstowe wyszukiwanie, potem streszczenie 1. trafienia.
      const searchRes = await fetchWithTimeout(
        `https://pl.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          query,
        )}&format=json&origin=*`,
      );
      if (!searchRes.ok) {
        return { error: `Wikipedia zwróciła błąd ${searchRes.status}. Spróbuj ponownie.` };
      }
      const search = await searchRes.json();
      const hit = search?.query?.search?.[0];
      if (!hit) return { error: `Nie znalazłem artykułu dla "${query}".` };

      const sumRes = await fetchWithTimeout(
        `https://pl.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          hit.title,
        )}`,
      );
      const sum = await sumRes.json();
      return {
        title: sum?.title ?? hit.title,
        summary: String(sum?.extract ?? "").slice(0, 1000),
        url: sum?.content_urls?.desktop?.page,
      };
    } catch (err) {
      return {
        error: networkErrorMessage(err, `Nie udało się przeszukać Wikipedii dla "${query}" (błąd połączenia).`),
      };
    }
  },
});

// ── Notatki agenta (pamięć w procesie serwera) ──────────────────────────────
type Note = { title: string; content: string; createdAt: string };
const notesStore: Note[] = [];

export const saveNote = tool({
  description:
    "Zapisuje notatkę w pamięci agenta. Używaj gdy trzeba zapamiętać wynik, listę, przeliczenie.",
  inputSchema: z.object({
    title: z.string().describe("Tytuł notatki"),
    content: z.string().describe("Treść notatki"),
  }),
  execute: async ({ title, content }) => {
    notesStore.push({ title, content, createdAt: new Date().toISOString() });
    return { saved: true, title };
  },
});

export const getNotes = tool({
  description:
    "Pobiera wszystkie zapisane notatki z pamięci agenta. Używaj gdy trzeba przypomnieć zapisane dane.",
  inputSchema: z.object({}),
  execute: async () => {
    return { notes: notesStore };
  },
});

// ── Baza wiedzy firmy (RAG — wyszukiwanie w Supabase) ───────────────────────
// Druga połowa RAG: pytanie → embedding → najbliższe fragmenty dokumentów.
// Dokumenty trafiają tu z /api/upload-knowledge (Warsztat 2).
// Samo wyszukiwanie siedzi w app/lib/knowledge.ts — dzieli je z podglądem
// bazy na stronie /knowledge.

// Fabryka narzędzia RAG powiązana z KONKRETNYM użytkownikiem — przeszukuje
// TYLKO dokumenty jego konta (izolacja danych, Warsztat 3). userId leci do
// searchKnowledgeBase, a stamtąd jako filter_user_id do funkcji match_documents.
// Bez userId (np. konteksty bez logowania) przeszukuje całą bazę — dziś każdy
// route jest za loginem, więc userId zawsze jest.
export function createSearchKnowledge(userId?: string) {
  return tool({
    description:
      "Wyszukuje informacje w bazie wiedzy firmy (cenniki, FAQ, regulaminy, oferty). " +
      "Używaj ZAWSZE gdy użytkownik pyta o: ceny, pakiety, koszty; procedury, regulaminy, warunki; " +
      "FAQ, pytania o firmę/usługi; cokolwiek co może być w dokumentach firmowych. " +
      "Zwraca też source_documents — tytuły dokumentów, które MUSISZ zacytować w odpowiedzi.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Pytanie użytkownika, np. 'ile kosztuje pakiet premium'"),
    }),
    execute: async ({ query }) => {
      if (!query || !query.trim()) {
        return {
          results: [],
          total_found: 0,
          source_documents: [],
          message: "Puste pytanie.",
        };
      }

      try {
        return await searchKnowledgeBase(query, { userId });
      } catch (err) {
        console.error("searchKnowledge: błąd wyszukiwania.", err);
        // Komunikat celowo mówi o BŁĘDZIE, a nie o braku wyników — inaczej agent
        // odmówiłby odpowiedzi ("nie mam tego w bazie"), choć baza może tę
        // informację mieć, tylko wyszukiwarka chwilowo nie odpowiada.
        return {
          results: [],
          total_found: 0,
          source_documents: [],
          message: "Nie udało się przeszukać bazy wiedzy (błąd połączenia).",
        };
      }
    },
  });
}

// ── Profil użytkownika (personalizacja) ─────────────────────────────────────
// Fabryka narzędzi powiązanych z KONKRETNYM użytkownikiem (userId).
// Tworzona per-request w API route, bo narzędzia muszą wiedzieć, czyj profil
// aktualizować. Zapis idzie do tabeli user_profiles w Supabase.
export function createProfileTools(userId: string) {
  // Model potrafi zapisać kilka faktów naraz ("jestem z Gdańska i lubię ramen")
  // — narzędzia lecą wtedy RÓWNOLEGLE w jednym kroku. Zapis preferencji to
  // read-modify-write na JSONB, więc równoległe wywołania czytały te same dane
  // i nadpisywały się nawzajem (zostawał tylko ostatni fakt).
  // Łańcuch obietnic ustawia je w kolejkę — każdy zapis widzi poprzedni.
  let queue: Promise<unknown> = Promise.resolve();
  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work, work);
    // Błąd jednego zapisu nie może zablokować kolejnych.
    queue = result.catch(() => undefined);
    return result;
  }

  const saveUserName = tool({
    description:
      "Zapisuje imię użytkownika w jego profilu. Wywołaj to narzędzie natychmiast, gdy użytkownik poda swoje imię (np. 'mam na imię Paweł', 'jestem Anna', 'nazywam się Jan').",
    inputSchema: z.object({
      name: z.string().describe("Imię użytkownika, np. 'Paweł'"),
    }),
    execute: async ({ name }) => {
      const clean = name.trim();
      if (!clean) return { error: "Puste imię — nie zapisano." };
      const { error } = await supabase
        .from("user_profiles")
        .update({ name: clean })
        .eq("id", userId);
      if (error) {
        console.error("Supabase: nie udało się zapisać imienia.", error);
        return { error: "Nie udało się zapisać imienia." };
      }
      return { saved: true, name: clean };
    },
  });

  const saveUserPreference = tool({
    description:
      "Zapisuje fakt o użytkowniku jako parę klucz-wartość w jego profilu. Wywołaj ZAWSZE, gdy użytkownik poda fakt o sobie lub odpowie na Twoje pytanie o niego (np. 'mieszkam w Krakowie' → key: 'miasto', value: 'Kraków'; 'lubię pizzę' → key: 'ulubione_jedzenie', value: 'pizza'). Używaj kluczy kanonicznych: 'miasto' (miasto zamieszkania) i 'ulubione_jedzenie' (ulubione jedzenie). Dla innych faktów możesz utworzyć własny klucz. Dopisuje do istniejących faktów, nie nadpisuje ich.",
    inputSchema: z.object({
      key: z
        .string()
        .describe("Nazwa faktu — najlepiej 'miasto' albo 'ulubione_jedzenie'"),
      value: z.string().describe("Wartość faktu, np. 'Kraków', 'pizza'"),
    }),
    execute: async ({ key, value }) => {
      // Normalizacja: 'city' / 'mieszka_w' → 'miasto'. Bez tego odczyt profilu
      // nie odnalazłby faktu, który agent przed chwilą zapisał.
      const k = canonicalFactKey(key);
      const v = value.trim();
      if (!k || !v) return { error: "Pusty klucz lub wartość — nie zapisano." };

      // Cały read-modify-write musi być w kolejce — inaczej równoległy zapis
      // wcisnąłby się między odczyt a update i przepadłby jeden z faktów.
      return serialized(async () => {
        // Merge do JSONB: odczytaj aktualne preferencje i dopisz nową parę.
        const { data: profile, error: readErr } = await supabase
          .from("user_profiles")
          .select("preferences")
          .eq("id", userId)
          .maybeSingle();
        if (readErr) {
          console.error("Supabase: nie udało się odczytać preferencji.", readErr);
          return { error: "Nie udało się zapisać preferencji." };
        }

        const current = (profile?.preferences ?? {}) as Record<string, unknown>;
        const preferences = { ...current, [k]: v };

        const { error } = await supabase
          .from("user_profiles")
          .update({ preferences })
          .eq("id", userId);
        if (error) {
          console.error("Supabase: nie udało się zapisać preferencji.", error);
          return { error: "Nie udało się zapisać preferencji." };
        }
        return { saved: true, key: k, value: v };
      });
    },
  });

  return { saveUserName, saveUserPreference };
}

// ── Generowanie obrazów (współdzielone przez /api/generate-image i agenta) ───
export const IMAGE_MODEL = "gemini-3.1-flash-lite-image";

type ImageResult = { image: string } | { error: string; status: number };

export async function generateImageData(prompt: string): Promise<ImageResult> {
  const apiKey =
    process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return { error: "Brak klucza API (GOOGLE_API_KEY).", status: 500 };

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: prompt,
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
        abortSignal: AbortSignal.timeout(28000),
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const mime = part.inlineData.mimeType ?? "image/png";
        return { image: `data:${mime};base64,${part.inlineData.data}` };
      }
    }
    return { error: "Model nie zwrócił obrazu.", status: 500 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === "TimeoutError") {
      return { error: "Generowanie trwało zbyt długo (timeout).", status: 500 };
    }

    let apiStatus: number | undefined;
    let apiText = "";
    try {
      const parsed = JSON.parse(message);
      apiStatus = parsed?.error?.code;
      apiText = parsed?.error?.message ?? "";
    } catch {
      apiText = message;
    }

    if (apiStatus === 429 || /quota|RESOURCE_EXHAUSTED|limit: 0/i.test(apiText)) {
      const isZeroTier = /limit: 0/.test(apiText);
      return {
        status: 429,
        error: isZeroTier
          ? `Model "${IMAGE_MODEL}" nie jest dostępny w darmowym planie (limit: 0). Generowanie obrazów Gemini wymaga włączenia płatności (billing).`
          : "Przekroczono limit zapytań (429). Spróbuj ponownie za chwilę.",
      };
    }

    console.error("Błąd generowania obrazu:", message);
    return { error: "Nie udało się wygenerować obrazu (błąd API).", status: 500 };
  }
}
