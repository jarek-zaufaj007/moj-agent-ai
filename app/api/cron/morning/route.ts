import { generateMorningBriefing, jsonUtf8 } from "@/app/lib/briefing";

export const maxDuration = 30;

// Cała logika (pogoda + kursy + AI + zapis) siedzi w app/lib/briefing.ts, bo
// dzieli ją z /api/briefings/generate (przycisk "Wygeneruj teraz" z L09 W4).
// Tutaj zostaje tylko to, co specyficzne dla crona: autoryzacja sekretem.

export async function GET(request: Request) {
  // Vercel Cron dokleja nagłówek `Authorization: Bearer $CRON_SECRET`, jeśli
  // zmienna CRON_SECRET jest ustawiona w projekcie. Bez sekretu odrzucamy —
  // celowo NIE porównujemy z `Bearer undefined`, bo wtedy każdy by wszedł.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await generateMorningBriefing("cron");

  if (!result.ok) {
    return jsonUtf8({ success: false, error: result.error }, result.status);
  }

  // Zwróć potwierdzenie z krótkim podglądem.
  return jsonUtf8({
    success: true,
    date: result.date,
    preview: result.content.slice(0, 200),
  });
}
