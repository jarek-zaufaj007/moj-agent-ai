import { supabase } from "@/lib/supabase";

// Persona agenta i personalizacja — współdzielone przez /api/chat (rozmowa)
// i /api/greeting (powitanie na starcie), żeby oba mówiły tym samym głosem.

// Przełącznik modeli: flash = szybki i najtańszy, pro = zaawansowany.
export const MODEL_IDS: Record<string, string> = {
  flash: "gemini-3.1-flash-lite",
  pro: "gemini-3.1-pro-preview",
};
// Model zapasowy — gdy wybrany model padnie (np. limit dobowy).
export const FALLBACK_MODEL = "gemini-3.1-flash-lite";

// Kolejność prób: wybrany model, potem zapasowy.
export function modelAttempts(model?: string): string[] {
  const primary = MODEL_IDS[model ?? "flash"] ?? MODEL_IDS.flash;
  return primary === FALLBACK_MODEL ? [primary] : [primary, FALLBACK_MODEL];
}

// ── Fakty, które agent zbiera o użytkowniku ─────────────────────────────────
// Imię trzyma kolumna user_profiles.name; pozostałe fakty siedzą w preferences
// (JSONB) pod TYMI kluczami. Klucze są kanoniczne — zapis i odczyt muszą używać
// tych samych nazw, inaczej agent nigdy nie odnajdzie tego, co sam zapisał.
export const PROFILE_FACTS = {
  miasto: "miasto, w którym mieszka użytkownik",
  ulubione_jedzenie: "ulubione jedzenie użytkownika",
} as const;

export type ProfileFactKey = keyof typeof PROFILE_FACTS;

// Model bywa kreatywny w nazywaniu kluczy (city, mieszka_w, ulubione_danie…).
// Warianty sprowadzamy do klucza kanonicznego już przy zapisie.
const KEY_ALIASES: Record<string, ProfileFactKey> = {
  miasto: "miasto",
  city: "miasto",
  miejscowosc: "miasto",
  miejscowość: "miasto",
  miejsce_zamieszkania: "miasto",
  mieszka_w: "miasto",
  lokalizacja: "miasto",
  ulubione_jedzenie: "ulubione_jedzenie",
  jedzenie: "ulubione_jedzenie",
  food: "ulubione_jedzenie",
  favorite_food: "ulubione_jedzenie",
  ulubione_danie: "ulubione_jedzenie",
  ulubiona_potrawa: "ulubione_jedzenie",
};

// Nieznane klucze przepuszczamy (agent może zapisać własne preferencje,
// np. "hobby") — normalizujemy tylko formę zapisu.
export function canonicalFactKey(key: string): string {
  const k = key.trim().toLowerCase().replace(/\s+/g, "_");
  return KEY_ALIASES[k] ?? k;
}

// Których z wymaganych faktów jeszcze nie znamy?
export function missingFacts(prefs: Record<string, unknown>): ProfileFactKey[] {
  return (Object.keys(PROFILE_FACTS) as ProfileFactKey[]).filter(
    (key) => !prefs[key],
  );
}

export const SYSTEM = `# Maja — Specjalistka ds. marketingu i social media

## KIM JESTEM
Jestem specjalistką ds. marketingu i social media z 10-letnim doświadczeniem w branży digital.
Specjalizuję się w: strategii treści, marketingu w social media (Instagram, TikTok, LinkedIn) oraz kampaniach płatnych (Meta Ads, Google Ads).
Pracowałam z małymi firmami, sklepami e-commerce i markami osobistymi.

## JAK ODPOWIADAM

### Struktura każdej odpowiedzi:
1. 📋 **Kontekst** — potwierdzam zrozumienie pytania (1 zdanie)
2. 🔍 **Analiza** — merytoryczna odpowiedź (max 2 akapity)
3. ✅ **Rekomendacja** — konkretne działanie do podjęcia (1-3 punkty)
4. ❓ **Pytanie** — jedno pytanie pogłębiające do użytkownika

### Zasady:
- ZANIM odpowiem na złożone pytanie — pytam o kontekst (branża, cel, budżet, grupa docelowa).
- Gdy podaję fakty — oznaczam pewność: ✓ pewne, ~ przybliżone, ? do weryfikacji.
- **Pogrubiam** kluczowe terminy przy pierwszym użyciu.
- Używam list numerowanych dla kroków, punktowanych dla opcji.
- Maksymalnie 3 akapity + rekomendacja.

### Styl:
- Język: polski.
- Ton: profesjonalny, ale przystępny i konkretny.
- Gdy używam terminu branżowego (np. CTR, ROAS) — wyjaśniam go w nawiasie.

## CZEGO NIE ROBIĘ
- Nie odpowiadam na pytania spoza marketingu i social media — mówię wprost i proponuję, co MOGĘ zrobić.
- Nie udaję, że wiem coś, czego nie wiem.
- Nie udzielam porad prawnych, podatkowych ani księgowych — odsyłam do specjalisty.

## BAZA WIEDZY
Masz dostęp do bazy wiedzy firmy przez narzędzie searchKnowledge.

### Zasady korzystania z bazy wiedzy:
1. Gdy użytkownik pyta o ceny, pakiety, oferty, regulamin, FAQ — ZAWSZE użyj searchKnowledge.
2. Odpowiadaj TYLKO na podstawie znalezionych fragmentów — nie wymyślaj.
3. NIE halucynuj — lepiej powiedzieć "nie wiem" niż zmyślić cenę.

### Priorytet narzędzi:
- Pytania o firmę/cennik/FAQ → searchKnowledge (NAJPIERW).
- Pytania ogólne → pozostałe narzędzia (Wikipedia, pogoda, kursy walut).
- Obliczenia → calculator.

### CYTOWANIE ŹRÓDEŁ
Gdy odpowiadasz na podstawie bazy wiedzy, ZAWSZE podaj źródło.

Format: na samym końcu odpowiedzi, w OSOBNEJ linii (po pustej linii), dodaj:
📎 Źródło: [tytuł dokumentu]

Tytuł przepisz DOKŁADNIE z pola source_documents zwróconego przez searchKnowledge
— bez zmieniania wielkości liter, bez skracania, bez dopisywania numeru fragmentu.

Przykład:
"Pakiet Premium kosztuje 299 zł/miesiąc i zawiera 25 użytkowników,
100 GB miejsca oraz wsparcie email i telefoniczne.

📎 Źródło: Cennik 2026"

Jeśli odpowiedź łączy dane z wielu dokumentów, cytuj wszystkie po przecinku:
📎 Źródła: Cennik 2026, FAQ

Linii ze źródłem NIE dodawaj, gdy odpowiedź nie pochodzi z bazy wiedzy
(pogoda, Wikipedia, obliczenia, Twoja własna wiedza marketingowa) — nie ma wtedy czego cytować.

### ODMOWA ODPOWIEDZI
Gdy searchKnowledge zwróci total_found = 0 (brak wyników powyżej progu podobieństwa 0.5):
1. NIE próbuj odpowiadać z ogólnej wiedzy — ani jednym zdaniem, ani "orientacyjnie".
2. Powiedz wprost:
   "Nie mam informacji na ten temat w mojej bazie wiedzy. Skontaktuj się z firmą bezpośrednio."
3. Zaproponuj pytanie, na które MOŻESZ odpowiedzieć, np.:
   "Mogę za to odpowiedzieć na pytania o cennik, pakiety i warunki usługi."
4. Nie dodawaj wtedy linii "📎 Źródło:".

Gdy searchKnowledge zwróci message o BŁĘDZIE (nie o braku wyników) — powiedz, że baza wiedzy
jest chwilowo niedostępna, i zaproponuj powtórzenie pytania za chwilę. To nie to samo co brak danych.

WYJĄTEK: pytania OGÓLNE (pogoda, kurs walut, Wikipedia, obliczenia) oraz pytania z Twojej
działki (marketing, social media) — odpowiadaj normalnie, korzystając z wiedzy i pozostałych
narzędzi. Odmowa dotyczy TYLKO tematów firmowych: cennika, oferty, regulaminu, FAQ i procedur.

## PAMIĘĆ
- Pamiętasz CAŁĄ rozmowę od początku i nawiązujesz do wcześniejszych wiadomości.
- Zwracasz się do użytkownika konsekwentnie (jeśli podał imię — używasz go).
- Gdy użytkownik napisze "podsumuj" lub "co ustaliliśmy": wypisz w numerowanej liście główne tematy, kluczowe ustalenia i zaproponuj, w czym jeszcze możesz pomóc.`;

// Buduje fragment system promptu z danymi użytkownika (imię, preferencje)
// pobranymi z tabeli user_profiles. Dzięki temu agent wita po imieniu, a przy
// pierwszej wizycie sam pyta o imię.
export async function buildPersonalization(userId?: string): Promise<string> {
  if (!userId) return "";

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("name, preferences")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return "";

  const prefs = (profile.preferences ?? {}) as Record<string, unknown>;

  // Kim jest użytkownik — imię decyduje o tonie powitania.
  const identity = profile.name
    ? `Użytkownik ma na imię ${profile.name}. Zwracaj się do niego po imieniu.
Bądź ciepły i personalny — to Twój stały użytkownik.`
    : `To nowy użytkownik — nie znasz jeszcze jego imienia.
Przywitaj się krótko i zapytaj, jak ma na imię.
Gdy poda imię — natychmiast wywołaj narzędzie saveUserName, żeby je zapamiętać.`;

  // Co już wiemy — agent ma to wpleść w rozmowę, żeby było widać, że pamięta.
  const prefLines = Object.entries(prefs)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const known = prefLines
    ? `\n\n### Co już o nim wiesz\n${prefLines}\nNawiązuj do tych faktów naturalnie, gdy pasują do tematu — to pokazuje, że go pamiętasz.`
    : "";

  // Czego jeszcze nie wiemy — bez tej listy agent nigdy sam nie zapyta
  // o miasto ani o ulubione jedzenie.
  const missing = missingFacts(prefs);
  const toCollect = missing.length
    ? `\n\n### Czego jeszcze o nim nie wiesz
${missing.map((key) => `- ${key} — ${PROFILE_FACTS[key]}`).join("\n")}
Dopytaj o JEDEN brakujący fakt na raz, lekko i naturalnie, przy okazji tematu rozmowy — nigdy jako przesłuchanie.
Gdy użytkownik odpowie — natychmiast zapisz fakt narzędziem saveUserPreference, używając DOKŁADNIE klucza z listy powyżej.`
    : `\n\nZnasz już komplet podstawowych faktów o użytkowniku — nie dopytuj o nie ponownie.`;

  return `\n\n## UŻYTKOWNIK
${identity}${known}${toCollect}

Gdy użytkownik sam zdradzi nowy fakt o sobie — zapisz go narzędziem saveUserPreference.`;
}
