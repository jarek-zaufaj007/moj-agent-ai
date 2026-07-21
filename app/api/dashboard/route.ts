// Agregator danych dla dashboardu — pobiera pogodę, kursy i święta z tych samych
// darmowych API co narzędzia agenta (Open-Meteo, NBP, Nager.Date), równolegle.
// To zwykły endpoint danych — NIE przechodzi przez agenta, żeby było szybko.

export const revalidate = 0;

const WEATHER_CODES: Record<number, { text: string; emoji: string }> = {
  0: { text: "bezchmurnie", emoji: "☀️" },
  1: { text: "głównie bezchmurnie", emoji: "🌤️" },
  2: { text: "częściowe zachmurzenie", emoji: "⛅" },
  3: { text: "pochmurno", emoji: "☁️" },
  45: { text: "mgła", emoji: "🌫️" },
  48: { text: "osadzająca się mgła", emoji: "🌫️" },
  51: { text: "mżawka słaba", emoji: "🌦️" },
  53: { text: "mżawka", emoji: "🌦️" },
  55: { text: "mżawka silna", emoji: "🌧️" },
  61: { text: "deszcz słaby", emoji: "🌦️" },
  63: { text: "deszcz", emoji: "🌧️" },
  65: { text: "deszcz silny", emoji: "🌧️" },
  71: { text: "śnieg słaby", emoji: "🌨️" },
  73: { text: "śnieg", emoji: "🌨️" },
  75: { text: "śnieg silny", emoji: "❄️" },
  80: { text: "przelotne opady", emoji: "🌦️" },
  81: { text: "przelotne opady", emoji: "🌧️" },
  82: { text: "ulewne opady", emoji: "⛈️" },
  95: { text: "burza", emoji: "⛈️" },
  96: { text: "burza z gradem", emoji: "⛈️" },
  99: { text: "burza z gradem", emoji: "⛈️" },
};

function timeout(ms = 6000) {
  return AbortSignal.timeout(ms);
}

async function fetchWeather(city: string) {
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        city,
      )}&count=1&language=pl`,
      { signal: timeout() },
    );
    const geo = await geoRes.json();
    const place = geo?.results?.[0];
    if (!place) return { error: `Nie znalazłem miasta "${city}".` };

    const { latitude, longitude, name } = place;
    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`,
      { signal: timeout() },
    );
    const w = await wRes.json();
    const c = w?.current;
    if (!c) return { error: "Brak danych pogodowych." };
    const wc = WEATHER_CODES[c.weather_code] ?? { text: "brak danych", emoji: "🌡️" };
    return {
      city: name,
      temperature: c.temperature_2m,
      humidity: c.relative_humidity_2m,
      windSpeed: c.wind_speed_10m,
      description: wc.text,
      emoji: wc.emoji,
    };
  } catch {
    return { error: "Nie udało się pobrać pogody." };
  }
}

async function fetchRate(currency: string) {
  try {
    // Ostatnie 2 notowania → różnica dla wskaźnika ↑/↓.
    const res = await fetch(
      `https://api.nbp.pl/api/exchangerates/rates/a/${currency}/last/2/?format=json`,
      { signal: timeout() },
    );
    if (!res.ok) return { currency, error: `Błąd NBP (${res.status}).` };
    const data = await res.json();
    const rates = data?.rates ?? [];
    const latest = rates[rates.length - 1];
    const prev = rates.length > 1 ? rates[rates.length - 2] : null;
    const delta = prev ? latest.mid - prev.mid : 0;
    return {
      currency,
      rate: latest?.mid,
      date: latest?.effectiveDate,
      delta,
      source: "NBP",
    };
  } catch {
    return { currency, error: "Nie udało się pobrać kursu." };
  }
}

type Holiday = { date: string; localName: string; name: string };

async function fetchHolidays() {
  const today = new Date();
  const y = today.getFullYear();
  const iso = today.toISOString().slice(0, 10);

  async function forYear(year: number): Promise<Holiday[]> {
    const res = await fetch(
      `https://date.nager.at/api/v3/publicholidays/${year}/PL`,
      { signal: timeout() },
    );
    if (!res.ok) return [];
    return (await res.json()) as Holiday[];
  }

  try {
    let list = await forYear(y);
    let upcoming = list.filter((h) => h.date >= iso);
    // Jeśli w tym roku nie ma już świąt — dobierz z przyszłego roku.
    if (upcoming.length < 3) {
      const next = await forYear(y + 1);
      upcoming = [...upcoming, ...next].filter((h) => h.date >= iso);
    }
    upcoming.sort((a, b) => a.date.localeCompare(b.date));
    const daysUntil = upcoming[0]
      ? Math.ceil(
          (new Date(upcoming[0].date).getTime() -
            new Date(iso).getTime()) /
            86_400_000,
        )
      : null;
    return {
      holidays: upcoming.slice(0, 5).map((h) => ({
        date: h.date,
        localName: h.localName,
      })),
      daysUntilNext: daysUntil,
    };
  } catch {
    return { error: "Nie udało się pobrać świąt." };
  }
}

function buildDateTime() {
  const now = new Date();
  const full = new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(now);
  const time = new Intl.DateTimeFormat("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Warsaw",
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("pl-PL", {
      hour: "2-digit",
      hour12: false,
      timeZone: "Europe/Warsaw",
    }).format(now),
  );
  const greeting =
    hour < 6
      ? "Dobrej nocy"
      : hour < 12
        ? "Dzień dobry"
        : hour < 18
          ? "Miłego popołudnia"
          : "Dobry wieczór";
  return { full, time, greeting };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const city = searchParams.get("city") || "Warszawa";

  const [weather, eur, usd, holidays] = await Promise.all([
    fetchWeather(city),
    fetchRate("EUR"),
    fetchRate("USD"),
    fetchHolidays(),
  ]);

  return Response.json({
    dateTime: buildDateTime(),
    weather,
    currencies: [eur, usd],
    holidays,
    updatedAt: new Date().toISOString(),
  });
}
