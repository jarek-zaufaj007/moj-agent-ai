import type { UIMessageChunk } from "ai";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Obrona wielowarstwowa (Lekcja 10, Warsztat 2) — trzy niezależne warstwy wokół
// /api/chat:
//   1. WEJŚCIE  — sanityzacja + limit długości + blacklist prób wyciągnięcia promptu
//   2. WYJŚCIE  — filtr strumienia odpowiedzi (nie wypuszczamy system promptu ani
//                 danych technicznych, nawet gdy model da się przekonać)
//   3. LIMIT    — 50 wiadomości na godzinę per user (tabela message_logs)
//
// Żadna warstwa nie jest szczelna sama z siebie — dopiero razem tworzą obronę.
// Wymaga migracji supabase/L10_W2_message_logs.sql.

export const MAX_INPUT_LENGTH = 2000;
export const RATE_LIMIT = 50;
export const RATE_WINDOW_MS = 60 * 60 * 1000;

export const BLOCKED_MESSAGE =
  "Ta wiadomość została zablokowana z powodów bezpieczeństwa.";
export const FILTERED_MESSAGE =
  "Przepraszam, nie mogę udostępnić tych informacji.";

// ── Warstwa 1: wejście ──────────────────────────────────────────────────────

// Znaki kontrolne i "niewidzialne" (zero-width space, joiner, BOM, znaczniki
// kierunku tekstu) służą do przemycania instrukcji tak, żeby człowiek ich nie
// zobaczył w polu czatu, a model owszem. Wycinamy je, zanim cokolwiek policzymy
// — inaczej blacklist da się ominąć wstawiając U+200B w środek "system prompt".
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFEFF]/g;

export function sanitizeInput(text: string): string {
  return text.replace(INVISIBLE, "").replace(/[ \t]{4,}/g, "  ").trim();
}

// Wzorce z Warsztatu 1 — tak wyglądały ataki, które wtedy działały.
const INPUT_PATTERNS: { re: RegExp; reason: string }[] = [
  {
    re: /ignore\s+(all\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?)|ignore\s+your\s+instructions?/i,
    reason: "ignore previous instructions",
  },
  {
    re: /zignoruj\s+(wszystkie\s+|te\s+)?(poprzednie|powyższe|wcześniejsze|swoje)\s+(instrukcje|polecenia|zasady)|zapomnij\s+(o\s+)?(swoich\s+)?instrukcj/i,
    reason: "zignoruj poprzednie instrukcje",
  },
  {
    re: /system\s*prompt|prompt\s+systemow|initial\s+prompt|twój\s+prompt|swój\s+prompt|pełny\s+prompt/i,
    reason: "pytanie o system prompt",
  },
  {
    re: /(pokaż|wypisz|podaj|wyświetl|powtórz|zacytuj)\s+(mi\s+)?(swoje|swój|całe|wszystkie|twoje)?\s*(instrukcje|zasady|wytyczne|konfiguracj)/i,
    reason: "prośba o ujawnienie instrukcji",
  },
  {
    re: /\b(reveal|disclose|repeat)\b.{0,30}\b(prompt|instructions?|rules|system)\b|show\s+me\s+your\b|translate\s+your\s+(system\s+)?prompt/i,
    reason: "reveal / show me your …",
  },
  {
    re: /ujawnij|zdradź\s+(mi\s+)?(swoje|swój)/i,
    reason: "ujawnij …",
  },
  {
    re: /(udawaj|pretend|act\s+as\s+if)\b.{0,60}\b(programist|developer|debug|inżynier|admin)/i,
    reason: "próba wejścia w tryb debugowania",
  },
  {
    // Cudze dane — po polsku określenie właściciela pada raz przed rzeczownikiem
    // ("innych userów rozmowy"), raz po nim ("rozmowy innych użytkowników"),
    // więc wzorzec musi łapać obie kolejności.
    re: /(rozmow|dan|dokument|profil|kont|wiadomośc|hasł)\w*\s+(innych|pozostałych|wszystkich)\s+(użytkownik|user)|(inn|wszystkich|pozostał)\w*\s+(użytkownik|user)\w*\b.{0,40}\b(rozmow|dan|dokument|profil|kont|wiadomośc)|other\s+users?\b.{0,40}\b(data|conversations?|messages?|documents?)|\buser[_\s]?id\b|user_profiles|message_logs|service_role/i,
    reason: "próba wyciągnięcia cudzych danych",
  },
];

export type InputVerdict =
  | { ok: true; text: string }
  | { ok: false; reason: string; text: string };

export function checkInput(raw: string): InputVerdict {
  const text = sanitizeInput(raw);

  if (text.length > MAX_INPUT_LENGTH) {
    return {
      ok: false,
      reason: `za długa wiadomość (${text.length} > ${MAX_INPUT_LENGTH} znaków)`,
      text,
    };
  }

  for (const { re, reason } of INPUT_PATTERNS) {
    if (re.test(text)) return { ok: false, reason, text };
  }

  return { ok: true, text };
}

// ── Warstwa 2: wyjście ──────────────────────────────────────────────────────

// Czego odpowiedź NIE ma zawierać. Blacklist wejścia łapie znane sformułowania
// ataku — ten filtr łapie SKUTEK: gdyby model dał się podejść czymś, czego nie
// przewidzieliśmy, wyciek i tak nie wyjdzie poza serwer.
const OUTPUT_PATTERNS: { re: RegExp; reason: string }[] = [
  {
    re: /system\s*prompt|prompt\s+systemow|moje\s+instrukcje\s+(brzmią|to)|instrukcje\s+systemowe/i,
    reason: "wzmianka o system prompcie",
  },
  {
    re: /#+\s*(KIM JESTEM|JAK ODPOWIADAM|CZEGO NIE ROBIĘ|BAZA WIEDZY|ODMOWA ODPOWIEDZI|UŻYTKOWNIK)\b/i,
    reason: "dosłowny fragment system promptu",
  },
  {
    re: /\b(API[_\s-]?KEY|SUPABASE_URL|SUPABASE_ANON_KEY|SERVICE_ROLE|GOOGLE_GENERATIVE_AI_API_KEY|CRON_SECRET|WEBHOOK_SECRET)\b/i,
    reason: "nazwa klucza / zmiennej środowiskowej",
  },
  {
    re: /\b(AIza[0-9A-Za-z_-]{10,}|sk-[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{20,})\b/,
    reason: "wygląda jak klucz API / token",
  },
  {
    re: /\b(user_profiles|message_logs|match_documents|webhook_events|supabase)\b/i,
    reason: "szczegóły techniczne bazy",
  },
  {
    re: /\b(searchKnowledge|saveUserName|saveUserPreference)\b/,
    reason: "wewnętrzne nazwy narzędzi",
  },
];

export function findLeak(text: string): string | null {
  for (const { re, reason } of OUTPUT_PATTERNS) {
    if (re.test(text)) return reason;
  }
  return null;
}

// Ile znaków odpowiedzi trzymamy w buforze, zanim wyślemy je do przeglądarki.
// To sedno filtra strumieniowego: skoro najdłuższy wzorzec ma ~40 znaków, a my
// zawsze przytrzymujemy ostatnie 120, to każdy wzorzec zdąży się domknąć w
// buforze ZANIM wyjdzie na zewnątrz. Wysłanego tekstu nie da się cofnąć —
// dlatego opóźnienie jest jedynym sposobem, by filtrować i nadal streamować.
const HOLD_CHARS = 120;

// Filtr strumienia odpowiedzi: przepuszcza wszystko (kroki, wywołania narzędzi,
// metadane), ale tekst wypuszcza z opóźnieniem i tylko gdy jest czysty. Po
// wykryciu wycieku ucina resztę odpowiedzi i podmienia ją na komunikat odmowy.
export function createOutputFilter(
  onLeak?: (reason: string) => void,
): TransformStream<UIMessageChunk, UIMessageChunk> {
  // Model może otworzyć kilka bloków tekstu (np. przed i po użyciu narzędzia) —
  // każdy ma własne id i własny bufor.
  const buffers = new Map<string, { acc: string; sent: number }>();
  let leaked = false;

  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (leaked) {
        // Po odmowie żadnego tekstu już nie wypuszczamy — przepuszczamy tylko
        // chunki domykające wiadomość, żeby klient nie został z otwartym
        // strumieniem.
        if (
          chunk.type === "finish" ||
          chunk.type === "finish-step" ||
          chunk.type === "message-metadata"
        ) {
          controller.enqueue(chunk);
        }
        return;
      }

      if (chunk.type === "text-delta") {
        const state = buffers.get(chunk.id) ?? { acc: "", sent: 0 };
        state.acc += chunk.delta;
        buffers.set(chunk.id, state);

        const reason = findLeak(state.acc);
        if (reason) {
          leaked = true;
          onLeak?.(reason);
          controller.enqueue({
            type: "text-delta",
            id: chunk.id,
            // Gdy część odpowiedzi już poszła (czysta — inaczej byśmy ją
            // złapali wcześniej), doklejamy odmowę w nowym akapicie.
            delta: state.sent > 0 ? `\n\n${FILTERED_MESSAGE}` : FILTERED_MESSAGE,
          });
          controller.enqueue({ type: "text-end", id: chunk.id });
          return;
        }

        const safeEnd = state.acc.length - HOLD_CHARS;
        if (safeEnd > state.sent) {
          controller.enqueue({
            type: "text-delta",
            id: chunk.id,
            delta: state.acc.slice(state.sent, safeEnd),
          });
          state.sent = safeEnd;
        }
        return;
      }

      if (chunk.type === "text-end") {
        // Koniec bloku — dopiero teraz można bezpiecznie oddać przytrzymaną
        // końcówkę: nic już do niej nie dojdzie.
        const state = buffers.get(chunk.id);
        if (state && state.sent < state.acc.length) {
          controller.enqueue({
            type: "text-delta",
            id: chunk.id,
            delta: state.acc.slice(state.sent),
          });
          state.sent = state.acc.length;
        }
      }

      controller.enqueue(chunk);
    },
  });
}

// ── Warstwa 3: limit wiadomości per user ────────────────────────────────────

export type RateVerdict =
  | { ok: true }
  | { ok: false; retryInMinutes: number };

// 50 wiadomości na godzinę, licząc też te zablokowane — dzięki temu zasypywanie
// agenta atakami zjada własny limit atakującego.
export async function checkRateLimit(userId?: string): Promise<RateVerdict> {
  // Bez tożsamości nie ma komu przypisać limitu. Czat wymaga logowania (L07),
  // więc w praktyce userId zawsze jest.
  if (!userId) return { ok: true };

  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();

  const { data, count, error } = await supabaseAdmin
    .from("message_logs")
    .select("created_at", { count: "exact" })
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    // Fail open: brak tabeli (nieuruchomiona migracja) albo chwilowy błąd bazy
    // nie może zablokować czatu wszystkim. Zostają warstwy 1 i 2.
    console.warn("Rate limiting nieaktywny — błąd message_logs:", error.message);
    return { ok: true };
  }

  if ((count ?? 0) < RATE_LIMIT) return { ok: true };

  // Pierwsze wolne miejsce zwolni się, gdy najstarsza wiadomość wypadnie z okna.
  const oldest = data?.[0]?.created_at
    ? new Date(data[0].created_at).getTime()
    : Date.now();
  const waitMs = oldest + RATE_WINDOW_MS - Date.now();

  return { ok: false, retryInMinutes: Math.max(1, Math.ceil(waitMs / 60000)) };
}

// Zapis do dziennika — to on napędza licznik limitu i zasili panel z Warsztatu 4
// (message_logs WHERE blocked = true). Treść zapisujemy TYLKO dla wiadomości
// zablokowanych i tylko w skrócie: normalne rozmowy siedzą już w tabeli
// messages, nie ma po co duplikować ich w logach bezpieczeństwa.
export async function logMessage(entry: {
  userId?: string;
  text: string;
  blocked?: boolean;
  reason?: string;
}): Promise<void> {
  if (!entry.userId) return;

  const { error } = await supabaseAdmin.from("message_logs").insert({
    user_id: entry.userId,
    message_length: entry.text.length,
    blocked: entry.blocked ?? false,
    reason: entry.reason ?? null,
    excerpt: entry.blocked ? entry.text.slice(0, 200) : null,
  });

  if (error) {
    // Dziennik jest dodatkiem — jego brak nie może przerwać odpowiedzi.
    console.warn("Nie udało się zapisać do message_logs:", error.message);
  }
}
