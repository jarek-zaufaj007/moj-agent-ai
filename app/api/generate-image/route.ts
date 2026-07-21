import { generateImageData } from "@/app/lib/tools";

export const maxDuration = 30;

export async function POST(req: Request) {
  let prompt: string;
  try {
    const body = await req.json();
    prompt = body?.prompt;
  } catch {
    return Response.json({ error: "Nieprawidłowe dane wejściowe." }, { status: 400 });
  }

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return Response.json({ error: "Podaj opis obrazu (prompt)." }, { status: 400 });
  }

  const result = await generateImageData(prompt.trim());

  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json({ image: result.image });
}
