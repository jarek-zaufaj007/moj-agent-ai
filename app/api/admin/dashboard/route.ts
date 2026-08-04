import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { startOfToday } from "@/app/lib/budget";
import { jsonUtf8 } from "@/app/lib/briefing";
import { authorizeAdmin, loadEmails, label } from "@/app/lib/adminAuth";

// Dashboard użycia (Lekcja 11, Warsztat 2) — źródło danych dla /admin/dashboard.
//
// Ten sam powód co przy panelu bezpieczeństwa: api_usage ma RLS bez polityk, a
// e-maile userów siedzą w auth.users — z przeglądarki anon key nie zobaczy ani
// jednego wiersza. Liczymy więc wszystko tutaj, kluczem service_role, po
// sprawdzeniu kto pyta (authorizeAdmin).

export const dynamic = "force-dynamic";

// Ile dni pokazują wykresy.
const DAYS = 7;

// Bezpieczniki na wielkość odpowiedzi — przy tej skali apki nigdy nie powinny
// się odezwać, ale wolę uciętą listę niż zapchaną pamięć na Vercelu.
const MAX_CONVERSATIONS = 5000;
const MAX_USAGE_ROWS = 20000;
const RECENT_LIMIT = 10;

// ── Cennik ──────────────────────────────────────────────────────────────────
// USD za MILION tokenów, osobno wejście i wyjście — modele liczą je inaczej
// (wyjście jest zwykle 4× droższe), więc jedna uśredniona stawka zaniżałaby
// rachunek przy długich odpowiedziach.
//
// ⚠️ To stawki wpisane ręcznie, nie pobierane z API Google. Zanim potraktujesz
// kwotę jak fakturę, sprawdź aktualny cennik (ai.google.dev/pricing) i popraw
// liczby tutaj — cała reszta dashboardu przeliczy się sama.
const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-3.1-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-3.1-flash-lite-image": { input: 0.1, output: 0.4 },
  "gemini-3.1-pro-preview": { input: 1.25, output: 10 },
  "gemini-embedding-001": { input: 0.15, output: 0 },
};

// Model spoza tabeli (np. dołożysz nowy) liczymy po stawce flash-lite, żeby
// koszt nie znikał po cichu z podsumowania.
const DEFAULT_PRICE = { input: 0.1, output: 0.4 };

function cost(model: string | null, input: number, output: number): number {
  const price = (model && PRICING[model]) || DEFAULT_PRICE;
  return (input * price.input + output * price.output) / 1_000_000;
}

// ── Doba po polsku ──────────────────────────────────────────────────────────
// Serwer na Vercelu chodzi w UTC, więc bez wymuszonej strefy "dziś" zaczynałoby
// się o 1:00 albo 2:00 naszego czasu — dokładnie ten sam problem, który
// rozwiązuje startOfToday() w budget.ts. Kubełki dnia muszą się z nim zgadzać,
// inaczej kafelek "tokeny dziś" pokazywałby co innego niż wykres.
const TZ = "Europe/Warsaw";

// en-CA daje "2026-08-04" — format, który sortuje się alfabetycznie.
const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const labelFmt = new Intl.DateTimeFormat("pl-PL", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

function dayKey(iso: string): string {
  return dayFmt.format(new Date(iso));
}

// Ostatnie n dni jako klucze "YYYY-MM-DD", od najstarszego.
//
// Cofamy się o pełne doby od POŁUDNIA UTC (13:00/14:00 w Warszawie), a nie od
// "teraz": przy zmianie czasu odejmowanie 24 h od godziny nocnej potrafi trafić
// dwa razy w ten sam dzień i wykres zgubiłby jedną kolumnę.
function lastDays(n: number): { key: string; label: string }[] {
  const anchor = new Date(`${dayKey(new Date().toISOString())}T12:00:00Z`).getTime();
  const out: { key: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(anchor - i * 86_400_000);
    out.push({ key: dayFmt.format(d), label: labelFmt.format(d) });
  }
  return out;
}

export async function GET(req: Request) {
  const auth = await authorizeAdmin(req);
  if (!auth.ok) return jsonUtf8({ ok: false, error: auth.error }, auth.status);

  const days = lastDays(DAYS);
  const todayKey = days[days.length - 1].key;
  const warnings: string[] = [];

  // Okno zapytań: 7 pełnych dób wstecz od dzisiejszej północy (z zapasem doby,
  // bo startOfToday liczy północ warszawską, a filtr w bazie działa na UTC).
  const weekStart = new Date(
    new Date(startOfToday()).getTime() - DAYS * 86_400_000,
  ).toISOString();

  // ── Dane źródłowe ─────────────────────────────────────────────────────────
  // Trzy zapytania równolegle: rozmowy (całość — potrzebujemy licznika userów),
  // łączna liczba wiadomości i zużycie tokenów z okna 7 dni.
  const [convRes, msgCountRes, usageRes] = await Promise.all([
    supabaseAdmin
      .from("conversations")
      // count: "exact" liczy WSZYSTKIE rozmowy, także te poza limitem 5000 —
      // kafelek ma pokazywać prawdę, nawet gdy lista zostanie ucięta.
      .select("id, title, created_at, updated_at, user_id", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(MAX_CONVERSATIONS),
    supabaseAdmin.from("messages").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("api_usage")
      .select("created_at, user_id, tokens_input, tokens_output, model, endpoint")
      .gte("created_at", weekStart)
      .limit(MAX_USAGE_ROWS),
  ]);

  // Brak tabeli (nieuruchomiona migracja) nie może wywalić panelu — pokazujemy
  // pustą sekcję i konkretną instrukcję, tak jak reszta aplikacji działa
  // "fail open" bez tych tabel.
  if (convRes.error) {
    warnings.push(
      "Nie mogę czytać conversations — uruchom migracje lekcja_05/supabase_setup.sql i supabase/W3_auth_isolacja.sql.",
    );
  }
  if (usageRes.error) {
    warnings.push(
      "Nie mogę czytać api_usage — uruchom migrację supabase/L10_W3_api_usage.sql.",
    );
  }

  const emails = await loadEmails();

  // ── 1. Rozmowy i użytkownicy ──────────────────────────────────────────────
  const convRows = (convRes.data ?? []) as {
    id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
    user_id: string | null;
  }[];

  // "Ilu userów" liczymy z rozmów, nie z auth.users: konto założone i nigdy
  // nieużyte to nie jest użytkownik agenta.
  const users = new Set(convRows.map((c) => c.user_id ?? "anon")).size;

  const convPerDay = new Map<string, number>();
  for (const c of convRows) {
    const key = dayKey(c.created_at);
    convPerDay.set(key, (convPerDay.get(key) ?? 0) + 1);
  }

  // ── 2. Tokeny i koszt ─────────────────────────────────────────────────────
  const usageRows = (usageRes.data ?? []) as {
    created_at: string;
    user_id: string | null;
    tokens_input: number | null;
    tokens_output: number | null;
    model: string | null;
    endpoint: string | null;
  }[];

  const tokensPerDay = new Map<string, number>();
  const costPerDay = new Map<string, number>();
  const perEndpoint = new Map<string, { tokens: number; cost: number; calls: number }>();

  let tokensWeek = 0;
  let costWeek = 0;
  let tokensToday = 0;
  let costToday = 0;
  let callsToday = 0;

  for (const r of usageRows) {
    const input = r.tokens_input ?? 0;
    const output = r.tokens_output ?? 0;
    const tokens = input + output;
    const usd = cost(r.model, input, output);
    const key = dayKey(r.created_at);

    tokensPerDay.set(key, (tokensPerDay.get(key) ?? 0) + tokens);
    costPerDay.set(key, (costPerDay.get(key) ?? 0) + usd);

    const ep = r.endpoint ?? "(nieznany)";
    const bucket = perEndpoint.get(ep) ?? { tokens: 0, cost: 0, calls: 0 };
    bucket.tokens += tokens;
    bucket.cost += usd;
    bucket.calls += 1;
    perEndpoint.set(ep, bucket);

    tokensWeek += tokens;
    costWeek += usd;
    if (key === todayKey) {
      tokensToday += tokens;
      costToday += usd;
      callsToday += 1;
    }
  }

  // Szereg czasowy zawsze ma 7 punktów — dzień bez ruchu to zero, nie dziura.
  // Inaczej wykres skłamałby: linia przeskoczyłaby ponad pustym wtorkiem, jakby
  // ruch był tam stały.
  const daily = days.map((d) => ({
    key: d.key,
    label: d.label,
    tokens: tokensPerDay.get(d.key) ?? 0,
    cost: costPerDay.get(d.key) ?? 0,
    conversations: convPerDay.get(d.key) ?? 0,
  }));

  const byEndpoint = [...perEndpoint.entries()]
    .map(([endpoint, v]) => ({ endpoint, ...v }))
    .sort((a, b) => b.tokens - a.tokens);

  // ── 3. Ostatnie rozmowy ───────────────────────────────────────────────────
  // Lista jest już posortowana malejąco po created_at, więc bierzemy 10 z góry
  // i dopiero dla NICH liczymy wiadomości — jedno zapytanie zamiast dziesięciu.
  const recentRows = convRows.slice(0, RECENT_LIMIT);
  const counts = new Map<string, number>();

  if (recentRows.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("messages")
      .select("conversation_id")
      .in(
        "conversation_id",
        recentRows.map((c) => c.id),
      );

    if (error) {
      warnings.push("Nie mogę policzyć wiadomości w rozmowach: " + error.message);
    }

    for (const m of (data ?? []) as { conversation_id: string }[]) {
      counts.set(m.conversation_id, (counts.get(m.conversation_id) ?? 0) + 1);
    }
  }

  const recent = recentRows.map((c) => ({
    id: c.id,
    title: c.title?.trim() || "(bez tytułu)",
    who: label(c.user_id, emails),
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    messages: counts.get(c.id) ?? 0,
  }));

  const conversationsTotal = convRes.count ?? convRows.length;

  return jsonUtf8({
    ok: true,
    stats: {
      users,
      conversations: conversationsTotal,
      // Ucięta lista rozmów zaniża liczbę userów i wykres 7 dni — mówimy o tym
      // wprost zamiast pokazywać po cichu niepełne dane.
      conversationsTruncated: conversationsTotal > convRows.length,
      messages: msgCountRes.count ?? 0,
      tokensToday,
      costToday,
      callsToday,
      tokensWeek,
      costWeek,
      days: DAYS,
    },
    daily,
    byEndpoint,
    recent,
    warnings,
  });
}
