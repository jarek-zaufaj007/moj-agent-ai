import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { DAILY_TOKEN_LIMIT, startOfToday } from "@/app/lib/budget";
import { jsonUtf8 } from "@/app/lib/briefing";

// Panel bezpieczeństwa (Lekcja 10, Warsztat 4) — źródło danych dla /admin/security.
//
// DLACZEGO ENDPOINT, A NIE ZAPYTANIE Z PRZEGLĄDARKI?
// message_logs i api_usage mają włączone RLS i ZERO polityk (patrz migracje
// L10_W2 i L10_W3) — anon key nie przeczyta z nich ani jednego wiersza. To
// celowe: gdyby przeglądarka miała dostęp, atakujący czytałby (i kasował) cudze
// logi. Panel czyta je więc tutaj, kluczem service_role, po sprawdzeniu kto pyta.

export const dynamic = "force-dynamic";

// Ile wstecz patrzymy. "Tydzień" liczymy kroczący (ostatnie 7 dni), nie od
// poniedziałku — w poniedziałek rano kolumna "tydzień" byłaby inaczej pusta.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Alert "za dużo wiadomości": >20 w oknie 10 minut. Limit z guard.ts (50/h) to
// twarda blokada; ten alert ma zapalić się WCZEŚNIEJ — przy nienaturalnym
// tempie, które wygląda na skrypt, a nie na człowieka.
const BURST_LIMIT = 20;
const BURST_WINDOW_MS = 10 * 60 * 1000;

// Alert "blisko limitu tokenów" — 80% dziennego budżetu.
const BUDGET_ALERT_RATIO = 0.8;

// Ile zablokowanych wiadomości pokazujemy na liście.
const BLOCKED_LIMIT = 50;

type Alert = {
  level: "red" | "amber";
  icon: string;
  title: string;
  detail: string;
  when: string | null;
};

// ── Kto może wejść do panelu ────────────────────────────────────────────────
// Token sesji przychodzi w nagłówku Authorization (strona bierze go z
// supabase.auth.getSession()). Weryfikujemy go po stronie serwera — samo
// przysłanie user_id w body niczego by nie dowodziło, każdy wpisałby cudze.
//
// ADMIN_EMAILS (opcjonalna, lista po przecinku) zawęża dostęp do konkretnych
// kont. Gdy jej nie ustawisz, panel widzi każdy zalogowany user — dla apki
// jednoosobowej to w porządku, ale zanim wpuścisz kogokolwiek innego, ustaw ją
// w .env.local i w zmiennych środowiskowych na Vercelu.
async function authorize(
  req: Request,
): Promise<{ ok: true; email: string } | { ok: false; status: number; error: string }> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return { ok: false, status: 401, error: "Brak tokenu sesji — zaloguj się." };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    return { ok: false, status: 401, error: "Sesja wygasła — zaloguj się ponownie." };
  }

  const email = data.user.email ?? "";
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length > 0 && !allowed.includes(email.toLowerCase())) {
    return { ok: false, status: 403, error: "To konto nie ma dostępu do panelu." };
  }

  return { ok: true, email };
}

// user_id → e-mail. Adresy siedzą w auth.users, do którego zwykły klient nie ma
// dostępu — tylko service_role przez auth.admin.
async function loadEmails(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) {
    console.warn("Nie udało się pobrać listy użytkowników:", error.message);
    return map;
  }

  for (const u of data.users) map.set(u.id, u.email ?? "(bez e-maila)");
  return map;
}

// Skrót user_id na wypadek, gdy konto zostało skasowane, a logi po nim zostały.
function label(userId: string | null, emails: Map<string, string>): string {
  if (!userId) return "(anonim)";
  return emails.get(userId) ?? `${userId.slice(0, 8)}…`;
}

// Najdłuższa seria wiadomości w oknie 10 minut — klasyczne dwa wskaźniki po
// posortowanej liście czasów, bez liczenia każdego okna od zera.
function maxBurst(times: number[]): { count: number; at: number } {
  let best = 0;
  let bestAt = 0;
  let start = 0;

  for (let end = 0; end < times.length; end++) {
    while (times[end] - times[start] > BURST_WINDOW_MS) start++;
    const count = end - start + 1;
    if (count > best) {
      best = count;
      bestAt = times[end];
    }
  }

  return { count: best, at: bestAt };
}

export async function GET(req: Request) {
  const auth = await authorize(req);
  if (!auth.ok) return jsonUtf8({ ok: false, error: auth.error }, auth.status);

  const todayISO = startOfToday();
  const weekISO = new Date(Date.now() - WEEK_MS).toISOString();
  const warnings: string[] = [];

  // ── Dane źródłowe ─────────────────────────────────────────────────────────
  // Trzy zapytania równolegle: zablokowane wiadomości, ruch z ostatniej doby
  // (do wykrywania serii) i zużycie tokenów z tygodnia.
  const [blockedRes, trafficRes, usageRes] = await Promise.all([
    supabaseAdmin
      .from("message_logs")
      // count: "exact" liczy WSZYSTKIE zablokowane, niezależnie od limitu 50 —
      // inaczej statystyka pokazywałaby "50" i zatrzymałaby się tam na zawsze.
      .select("id, created_at, user_id, reason, excerpt, message_length", {
        count: "exact",
      })
      .eq("blocked", true)
      .order("created_at", { ascending: false })
      .limit(BLOCKED_LIMIT),
    supabaseAdmin
      .from("message_logs")
      .select("created_at, user_id")
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true })
      .limit(5000),
    supabaseAdmin
      .from("api_usage")
      .select("created_at, user_id, tokens_input, tokens_output")
      .gte("created_at", weekISO)
      .limit(20000),
  ]);

  // Brak tabeli (nieuruchomiona migracja) nie może wywalić panelu — pokazujemy
  // pustą sekcję i konkretną instrukcję, tak jak reszta aplikacji działa
  // "fail open" bez tych tabel.
  if (blockedRes.error || trafficRes.error) {
    warnings.push(
      "Nie mogę czytać message_logs — uruchom migrację supabase/L10_W2_message_logs.sql.",
    );
  }
  if (usageRes.error) {
    warnings.push(
      "Nie mogę czytać api_usage — uruchom migrację supabase/L10_W3_api_usage.sql.",
    );
  }

  const emails = await loadEmails();

  // ── 1. Zablokowane wiadomości ─────────────────────────────────────────────
  const blockedRows = (blockedRes.data ?? []) as {
    id: string;
    created_at: string;
    user_id: string | null;
    reason: string | null;
    excerpt: string | null;
    message_length: number | null;
  }[];

  const blocked = blockedRows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    who: label(r.user_id, emails),
    reason: r.reason ?? "nieznany powód",
    // excerpt to już maks. 200 znaków z guard.ts — na listę tniemy do 160.
    excerpt: (r.excerpt ?? "").slice(0, 160),
    length: r.message_length ?? 0,
  }));

  // ── 2. Top 5 użytkowników po zużyciu ──────────────────────────────────────
  const usageRows = (usageRes.data ?? []) as {
    created_at: string;
    user_id: string | null;
    tokens_input: number | null;
    tokens_output: number | null;
  }[];

  const perUser = new Map<string, { today: number; week: number; calls: number }>();
  const todayMs = new Date(todayISO).getTime();

  for (const r of usageRows) {
    const key = r.user_id ?? "anon";
    const entry = perUser.get(key) ?? { today: 0, week: 0, calls: 0 };
    const tokens = (r.tokens_input ?? 0) + (r.tokens_output ?? 0);
    entry.week += tokens;
    entry.calls += 1;
    if (new Date(r.created_at).getTime() >= todayMs) entry.today += tokens;
    perUser.set(key, entry);
  }

  const top = [...perUser.entries()]
    .map(([userId, v]) => ({
      userId,
      who: label(userId === "anon" ? null : userId, emails),
      today: v.today,
      week: v.week,
      calls: v.calls,
      percent: Math.round((v.today / DAILY_TOKEN_LIMIT) * 100),
    }))
    // Sortujemy po DZISIEJSZYM zużyciu — panel ma odpowiadać na pytanie "kto
    // pali budżet teraz", a nie "kto był aktywny w poniedziałek".
    .sort((a, b) => b.today - a.today || b.week - a.week)
    .slice(0, 5);

  // ── 3. Alerty ─────────────────────────────────────────────────────────────
  const alerts: Alert[] = [];

  // (a) blisko dziennego limitu tokenów
  for (const u of [...perUser.entries()]) {
    const [userId, v] = u;
    if (v.today >= DAILY_TOKEN_LIMIT * BUDGET_ALERT_RATIO) {
      const pct = Math.round((v.today / DAILY_TOKEN_LIMIT) * 100);
      alerts.push({
        level: v.today >= DAILY_TOKEN_LIMIT ? "red" : "amber",
        icon: v.today >= DAILY_TOKEN_LIMIT ? "🚫" : "⚡",
        title:
          v.today >= DAILY_TOKEN_LIMIT
            ? `${label(userId === "anon" ? null : userId, emails)} wyczerpał dzienny limit`
            : `${label(userId === "anon" ? null : userId, emails)} na ${pct}% limitu`,
        detail: `${v.today.toLocaleString("pl-PL")} / ${DAILY_TOKEN_LIMIT.toLocaleString("pl-PL")} tokenów dziś`,
        when: null,
      });
    }
  }

  // (b) seria wiadomości — >20 w 10 minut
  const trafficRows = (trafficRes.data ?? []) as {
    created_at: string;
    user_id: string | null;
  }[];

  const times = new Map<string, number[]>();
  for (const r of trafficRows) {
    const key = r.user_id ?? "anon";
    const list = times.get(key) ?? [];
    list.push(new Date(r.created_at).getTime());
    times.set(key, list);
  }

  for (const [userId, list] of times) {
    const burst = maxBurst(list); // lista jest już rosnąco (order w zapytaniu)
    if (burst.count > BURST_LIMIT) {
      alerts.push({
        level: "amber",
        icon: "🌊",
        title: `${label(userId === "anon" ? null : userId, emails)} — ${burst.count} wiadomości w 10 minut`,
        detail: `Próg alertu: ${BURST_LIMIT}. Tempo wygląda na automat, nie na rozmowę.`,
        when: new Date(burst.at).toISOString(),
      });
    }
  }

  // (c) każda zablokowana wiadomość z ostatniej doby — to najostrzejszy sygnał:
  //     ktoś świadomie próbował obejść agenta.
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const b of blocked) {
    if (new Date(b.createdAt).getTime() < dayAgo) continue;
    alerts.push({
      level: "red",
      icon: "🛑",
      title: `Zablokowana wiadomość — ${b.who}`,
      detail: b.reason,
      when: b.createdAt,
    });
  }

  // Najnowsze/najostrzejsze na górze: czerwone przed bursztynowymi, potem po dacie.
  alerts.sort((a, b) => {
    if (a.level !== b.level) return a.level === "red" ? -1 : 1;
    return (b.when ?? "").localeCompare(a.when ?? "");
  });

  // ── 4. Statystyki ─────────────────────────────────────────────────────────
  const tokensWeek = [...perUser.values()].reduce((s, v) => s + v.week, 0);
  const tokensToday = [...perUser.values()].reduce((s, v) => s + v.today, 0);
  const activeUsers = perUser.size;

  const stats = {
    tokensToday,
    tokensWeek,
    blockedCount: blockedRes.count ?? blocked.length,
    blockedToday: blocked.filter((b) => new Date(b.createdAt).getTime() >= todayMs)
      .length,
    // Lista jest ucięta do 50 — mówimy o tym wprost, żeby nikt nie wziął jej
    // za komplet, gdy zablokowanych jest więcej.
    blockedTruncated: (blockedRes.count ?? 0) > blocked.length,
    activeUsers,
    // Średnia liczona po userach, którzy w tym tygodniu w ogóle coś zrobili —
    // dzielenie przez wszystkich kiedykolwiek aktywnych zaniżałoby ją bez sensu.
    avgPerUser: activeUsers > 0 ? Math.round(tokensWeek / activeUsers) : 0,
    messages24h: trafficRows.length,
    // Osobny licznik: kafelek "wiadomości" musi liczyć userów z RUCHU, nie
    // z api_usage. Inaczej pokazuje "2 wiadomości / 0 aktywnych userów" —
    // np. gdy jedyna wiadomość została zablokowana i nigdy nie doszła do modelu.
    activeUsers24h: times.size,
    dailyLimit: DAILY_TOKEN_LIMIT,
  };

  return jsonUtf8({ ok: true, blocked, top, alerts, stats, warnings });
}
