import { google } from "@ai-sdk/google";
import { generateText, stepCountIs } from "ai";
import { SYSTEM, buildPersonalization, modelAttempts } from "@/app/lib/persona";

export const maxDuration = 30;

// Ochrona przed pętlami — twardy limit kroków agenta.
const maxSteps = 3;

// Powitanie generowane przy otwarciu pustej rozmowy. Agent układa je na
// podstawie profilu z user_profiles — dlatego po restarcie przeglądarki wita
// po imieniu i nawiązuje do zapamiętanych preferencji.
//
// Powitanie NIE jest zapisywane w bazie — powstaje na nowo przy każdym wejściu,
// zawsze z aktualnego profilu.

// Powitanie to nie odpowiedź merytoryczna, więc wyłączamy strukturę 4-punktową
// z persony — inaczej "Cześć" przyjeżdża w formacie Kontekst/Analiza/Rekomendacja.
const GREETING_INSTRUCTION = `Rozpoczyna się nowa rozmowa — użytkownik dopiero wszedł na stronę i jeszcze nic nie napisał.
Przywitaj go pierwsza.

Zasady TEGO powitania (nadpisują sekcję "JAK ODPOWIADAM"):
- NIE używaj struktury Kontekst/Analiza/Rekomendacja/Pytanie.
- 2-3 zdania, ciepło i naturalnie, bez nagłówków i list.
- Jeśli znasz imię użytkownika — przywitaj go po imieniu.
- Jeśli znasz jego preferencje — nawiąż do jednej z nich naturalnie, żeby pokazać, że pamiętasz.
- Zakończ jednym krótkim pytaniem o to, nad czym chce dziś popracować.
- Jeśli NIE znasz jego imienia — przedstaw się krótko i zapytaj, jak ma na imię.`;

export async function POST(req: Request) {
  const { userId, model = "flash" }: { userId?: string; model?: string } =
    await req.json();

  if (!userId) {
    return Response.json({ greeting: null });
  }

  const system = SYSTEM + (await buildPersonalization(userId));

  let lastError: unknown;
  for (const modelId of modelAttempts(model)) {
    try {
      const { text } = await generateText({
        model: google(modelId),
        system,
        prompt: GREETING_INSTRUCTION,
        stopWhen: stepCountIs(maxSteps),
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(20000),
      });
      return Response.json({ greeting: text, model: modelId });
    } catch (err) {
      lastError = err;
      console.warn(`Powitanie: model ${modelId} niedostępny, próbuję dalej.`);
    }
  }

  // Powitanie jest dodatkiem — gdy modele padną, czat ma działać normalnie.
  console.error("Nie udało się wygenerować powitania.", lastError);
  return Response.json({ greeting: null });
}
