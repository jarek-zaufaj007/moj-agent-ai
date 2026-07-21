import { google } from "@ai-sdk/google";
import { generateText, stepCountIs } from "ai";

export const maxDuration = 30;

const MODEL = "gemini-3.1-flash-lite";

// Ochrona przed pętlami — twardy limit kroków agenta.
const maxSteps = 3;

// Zamienia obraz + instrukcję na gotowy prompt do generatora grafik.
export async function POST(req: Request) {
  let image: string;
  let instruction: string;
  try {
    const body = await req.json();
    image = body?.image;
    instruction =
      body?.instruction ?? "podobny obraz, ale w innym stylu graficznym";
  } catch {
    return Response.json({ error: "Nieprawidłowe dane." }, { status: 400 });
  }

  if (!image || typeof image !== "string") {
    return Response.json({ error: "Brak obrazu." }, { status: 400 });
  }

  // Wyłuskaj typ MIME z data URL (np. "data:image/png;base64,...").
  const mediaType = image.match(/^data:([^;]+);/)?.[1] ?? "image/png";

  try {
    const { text } = await generateText({
      model: google(MODEL),
      stopWhen: stepCountIs(maxSteps),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(20000),
      system:
        "Jesteś ekspertem od promptów do generatorów obrazów AI. Na podstawie obrazu i instrukcji tworzysz JEDEN zwięzły, szczegółowy prompt w języku ANGIELSKIM (styl, kompozycja, kolory, oświetlenie, nastrój). Zwróć WYŁĄCZNIE sam prompt — bez komentarzy, cudzysłowów i wyjaśnień.",
      messages: [
        {
          role: "user",
          content: [
            { type: "file", data: image, mediaType },
            {
              type: "text",
              text: `Opisz ten obraz jako prompt do wygenerowania nowej wersji. Instrukcja zmiany: ${instruction}`,
            },
          ],
        },
      ],
    });

    const prompt = text.trim();
    if (!prompt) {
      return Response.json(
        { error: "Nie udało się utworzyć promptu." },
        { status: 500 },
      );
    }
    return Response.json({ prompt });
  } catch (err) {
    console.error("vision-prompt error:", err);
    return Response.json(
      { error: "Nie udało się przeanalizować obrazu." },
      { status: 500 },
    );
  }
}
