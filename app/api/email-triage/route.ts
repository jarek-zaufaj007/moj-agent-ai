import { google } from "@ai-sdk/google";
import { streamText } from "ai";

export const maxDuration = 30;

// Najtańszy model — jeden dla całego projektu (oszczędzanie limitu API).
const MODEL = "gemini-3.1-flash-lite";

const SYSTEM = `Jesteś profesjonalnym asystentem do zarządzania pocztą.

Dla KAŻDEGO maila wykonaj:
1. 📧 KATEGORYZACJA: określ typ (zapytanie ofertowe / reklamacja / spam / informacja / prośba o spotkanie)
2. 🔴🟡🟢 PRIORYTET: Wysoki (wymaga odpowiedzi dziś) / Średni (w ciągu 3 dni) / Niski (może poczekać)
3. ✍️ DRAFT: Napisz krótki, profesjonalny szkic odpowiedzi (3-5 zdań)

FORMAT ODPOWIEDZI:
Dla każdego maila:

### Mail [numer]: [krótki temat]
| Kategoria | [typ] |
| Priorytet | [🔴 Wysoki / 🟡 Średni / 🟢 Niski] |
| Uzasadnienie | [dlaczego ten priorytet] |

**Proponowana odpowiedź:**
> [draft odpowiedzi]

---

Na końcu: PODSUMOWANIE
- 🔴 Pilne: [ile] maili
- 🟡 Średnie: [ile] maili
- 🟢 Niskie: [ile] maili
- ✅ Rekomendacja: [który mail obsłużyć najpierw]`;

export async function POST(req: Request) {
  const { emails }: { emails: string[] } = await req.json();

  const list = (emails ?? []).filter((e) => e && e.trim());

  if (list.length === 0) {
    return new Response("Brak maili do analizy.", { status: 400 });
  }

  // Numerujemy maile, żeby model trzymał się kolejności w odpowiedzi.
  const userPrompt = list
    .map((email, i) => `=== MAIL ${i + 1} ===\n${email.trim()}`)
    .join("\n\n");

  const result = streamText({
    model: google(MODEL),
    system: SYSTEM,
    prompt: userPrompt,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(25000),
  });

  return result.toTextStreamResponse();
}
