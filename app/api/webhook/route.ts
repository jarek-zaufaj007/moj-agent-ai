import { google } from "@ai-sdk/google";
import { generateText } from "ai";
// Webhook przychodzi z zewnątrz — nie ma zalogowanego usera (auth.uid() = NULL),
// więc piszemy kluczem service_role (omija RLS). Tak samo jak /api/cron/morning.
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 30;

// Najtańszy model — jeden dla całego projektu (oszczędzanie limitu API).
const MODEL = "gemini-3.1-flash-lite";

// Obsługiwane typy zdarzeń. Nieznany typ odrzucamy PRZED wywołaniem modelu —
// endpoint jest publiczny, więc nie pozwalamy palić limitu API na śmieciach.
const HANDLERS = {
  feedback: {
    system: `Jesteś analitykiem obsługi klienta. Przeanalizuj opinię klienta.

FORMAT ODPOWIEDZI (markdown, po polsku):

## 📊 Analiza feedbacku
| Sentyment | [🔴 Negatywny / 🟡 Neutralny / 🟢 Pozytywny] |
| Priorytet | [🔴 Wysoki / 🟡 Średni / 🟢 Niski] |
| Uzasadnienie | [1 zdanie: dlaczego taki priorytet] |

**Główny problem:** [1 zdanie — czego dotyczy skarga/pochwała]

**Sugerowana odpowiedź do klienta:**
> [3-4 zdania, profesjonalnie i konkretnie, zwróć się do klienta po imieniu]

Zwięźle. Nie zmyślaj faktów, których nie ma w danych.`,
    task: "Przeanalizuj tę opinię klienta.",
  },
  alert: {
    system: `Jesteś inżynierem dyżurnym (on-call). Przeanalizuj alert z monitoringu.

FORMAT ODPOWIEDZI (markdown, po polsku):

## 🚨 Analiza alertu
| Severity | [🔴 Krytyczny / 🟠 Wysoki / 🟡 Średni / 🟢 Niski] |
| Wpływ | [kogo/co dotyka awaria] |
| Czas trwania | [jak długo trwa, jeśli da się wyliczyć z danych] |

**Prawdopodobne przyczyny:**
- [2-3 hipotezy]

**Rekomendowane działanie (po kolei):**
1. [pierwszy krok — najpilniejszy]
2. [...]

**Kogo powiadomić:** [rola/zespół]

Zwięźle. Nie zmyślaj metryk, których nie ma w danych.`,
    task: "Przeanalizuj ten alert i zaproponuj działanie.",
  },
  order: {
    system: `Jesteś asystentem sprzedaży. Potwierdź zamówienie i podsumuj je.

FORMAT ODPOWIEDZI (markdown, po polsku):

## 🧾 Podsumowanie zamówienia
| Produkt | [nazwa] |
| Kwota | [kwota] |
| Klient | [klient] |

**Potwierdzenie dla klienta:**
> [2-3 zdania: podziękowanie, co dalej]

**Notatka wewnętrzna:** [1 zdanie — np. czy to klient premium, czy wymaga uwagi]

Zwięźle. Używaj wyłącznie danych z zamówienia.`,
    task: "Potwierdź to zamówienie i wygeneruj podsumowanie.",
  },
} as const;

type EventType = keyof typeof HANDLERS;

const TYPES = Object.keys(HANDLERS) as EventType[];

// JSON z jawnym charset=utf-8 — bez tego przeglądarka zgaduje kodowanie
// i psuje polskie znaki oraz emoji (tak jak w /api/cron/morning).
function jsonUtf8(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  // ── 0. Opcjonalny sekret ──────────────────────────────────────────────────
  // Endpoint jest publiczny — każdy, kto zna URL, może wywołać model na nasz
  // limit API. Jeśli ustawisz WEBHOOK_SECRET w .env.local / Vercelu, wymagamy
  // nagłówka `x-webhook-secret`. Bez zmiennej wpuszczamy wszystkich, żeby test
  // z DevTools z W3 działał od razu — na produkcji USTAW sekret.
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && request.headers.get("x-webhook-secret") !== secret) {
    return jsonUtf8({ success: false, error: "Unauthorized" }, 401);
  }

  // ── 1. Payload ────────────────────────────────────────────────────────────
  // Webhook dostaje dane z zewnątrz, więc niepoprawny JSON jest normalnym
  // przypadkiem, nie wyjątkiem — łapiemy i zwracamy 400.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonUtf8({ success: false, error: "Body nie jest poprawnym JSON-em." }, 400);
  }

  const { type, data } = (body ?? {}) as { type?: unknown; data?: unknown };

  if (typeof type !== "string" || !TYPES.includes(type as EventType)) {
    return jsonUtf8(
      { success: false, error: `Pole "type" musi być jednym z: ${TYPES.join(", ")}.` },
      400,
    );
  }

  // `data` musi być obiektem — string/liczba/null nie mają czego analizować
  // i nie zmieszczą się w kolumnie jsonb tak, jak tego oczekujemy.
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return jsonUtf8({ success: false, error: 'Pole "data" musi być obiektem JSON.' }, 400);
  }

  const handler = HANDLERS[type as EventType];

  // ── 2. Analiza agenta ─────────────────────────────────────────────────────
  // Payload wstrzykujemy jako JSON — model radzi sobie z tym lepiej niż
  // z ręcznie sklejanym tekstem, a nie musimy znać z góry wszystkich pól.
  let analysis: string;
  try {
    const { text } = await generateText({
      model: google(MODEL),
      system: handler.system,
      prompt: `${handler.task}\n\nDane zdarzenia (JSON):\n${JSON.stringify(data, null, 2)}`,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(25000),
    });
    analysis = text.trim();
  } catch (err) {
    console.error(`webhook (${type}): nie udało się wygenerować analizy.`, err);
    return jsonUtf8(
      { success: false, error: "Nie udało się przeanalizować zdarzenia (model niedostępny)." },
      502,
    );
  }

  // ── 3. Zapis w Supabase (tabela webhook_events — L09_W3_webhook.sql) ──────
  const { data: inserted, error: dbError } = await supabaseAdmin
    .from("webhook_events")
    .insert({ type, data, analysis })
    .select("id")
    .single();

  if (dbError) {
    // Logujemy pola wprost — logger Next-a serializuje obiekt błędu Supabase
    // jako "{}", więc bez tego w konsoli nie widać, CO właściwie padło
    // (np. PGRST205 = nie uruchomiłeś L09_W3_webhook.sql).
    console.error(
      `webhook (${type}): nie udało się zapisać zdarzenia. ` +
        `[${dbError.code}] ${dbError.message}${dbError.hint ? ` — ${dbError.hint}` : ""}`,
    );
    // Analiza się udała — zwracamy ją, żeby nie przepadła, ale sygnalizujemy błąd.
    return jsonUtf8(
      {
        success: false,
        error: "Zdarzenie przeanalizowane, ale zapis w bazie się nie powiódł.",
        analysis,
      },
      500,
    );
  }

  // ── 4. Odpowiedź zgodna z W3 ──────────────────────────────────────────────
  return jsonUtf8({ success: true, analysis, event_id: inserted.id });
}
