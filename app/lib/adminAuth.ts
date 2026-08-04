import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Wspólna bramka panelu administracyjnego — używają jej /api/admin/security
// (Lekcja 10, Warsztat 4) i /api/admin/dashboard (Lekcja 11, Warsztat 2).
//
// Oba endpointy czytają tabele z włączonym RLS kluczem service_role, więc to
// TU jest jedyne miejsce, które decyduje, kto w ogóle może pytać. Jedna kopia
// zamiast dwóch: gdy zaostrzysz reguły (np. dołożysz rolę w bazie), nie ma
// szansy, że drugi panel zostanie z luźniejszą wersją.

// ── Kto może wejść do panelu ────────────────────────────────────────────────
// Token sesji przychodzi w nagłówku Authorization (strona bierze go z
// supabase.auth.getSession()). Weryfikujemy go po stronie serwera — samo
// przysłanie user_id w body niczego by nie dowodziło, każdy wpisałby cudze.
//
// ADMIN_EMAILS (opcjonalna, lista po przecinku) zawęża dostęp do konkretnych
// kont. Gdy jej nie ustawisz, panel widzi każdy zalogowany user — dla apki
// jednoosobowej to w porządku, ale zanim wpuścisz kogokolwiek innego, ustaw ją
// w .env.local i w zmiennych środowiskowych na Vercelu.
export async function authorizeAdmin(
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
export async function loadEmails(): Promise<Map<string, string>> {
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

// Skrót user_id na wypadek, gdy konto zostało skasowane, a dane po nim zostały.
export function label(userId: string | null, emails: Map<string, string>): string {
  if (!userId) return "(anonim)";
  return emails.get(userId) ?? `${userId.slice(0, 8)}…`;
}
