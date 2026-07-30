import { generateMorningBriefing, jsonUtf8 } from "@/app/lib/briefing";

export const maxDuration = 30;

// Ręczne wywołanie briefingu z przycisku "🔄 Wygeneruj teraz" na /briefings.
//
// DLACZEGO OSOBNY ENDPOINT, a nie wołanie /api/cron/morning z przeglądarki?
// Tamten wymaga nagłówka `Authorization: Bearer $CRON_SECRET`, a sekretu NIE
// wolno umieszczać w kodzie klienckim (każdy odczytałby go z DevTools i mógł
// odpalać cron w kółko). Ten endpoint robi to samo, ale bez sekretu — jest
// POST-only, więc nie da się go wywołać przypadkiem przez wklejenie URL-a
// w pasek adresu ani przez prefetch linku.

export async function POST() {
  const result = await generateMorningBriefing("manual");

  if (!result.ok) {
    return jsonUtf8({ success: false, error: result.error }, result.status);
  }

  return jsonUtf8({ success: true, date: result.date });
}
