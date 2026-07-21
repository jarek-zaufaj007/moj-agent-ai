// Dzielenie długiego tekstu na fragmenty ("chunki") pod embeddingi.
//
// Dlaczego w ogóle dzielimy: embedding całego dokumentu to jeden uśredniony
// "adres znaczeniowy" — im dłuższy tekst, tym bardziej rozmyty. Krótkie
// fragmenty dają precyzyjne trafienia ("Pakiet Premium: 299 zł"), a agent
// dostaje w kontekście tylko to, co faktycznie potrzebne.

// Zdanie kończy się kropką/wykrzyknikiem/pytajnikiem albo nową linią.
// Nowa linia jest tu ważna — cenniki i FAQ to często listy bez kropek.
function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Ogon poprzedniego chunka (~overlap znaków), urwany do granicy słowa.
// Overlap ratuje zdania rozdzielone przez granicę chunków — bez niego
// "Pakiet VIP kosztuje" i "599 zł" mogłyby wylądować w osobnych fragmentach
// i żaden nie odpowiedziałby na pytanie o cenę VIP.
function tailOf(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return text;
  const tail = text.slice(-overlap);
  const spaceAt = tail.indexOf(" ");
  return spaceAt === -1 ? tail : tail.slice(spaceAt + 1);
}

export function splitIntoChunks(
  text: string,
  chunkSize: number = 500,
  overlap: number = 50,
): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];

  const sentences = splitIntoSentences(clean);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    // Pojedyncze zdanie dłuższe niż chunkSize (np. akapit regulaminu bez kropek)
    // — tnij je twardo, inaczej jeden chunk urósłby bez ograniczeń.
    if (sentence.length > chunkSize) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += chunkSize) {
        const piece = sentence.slice(i, i + chunkSize);
        if (i + chunkSize >= sentence.length) current = piece; // ogon wraca do pętli
        else chunks.push(piece);
      }
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;

    if (candidate.length <= chunkSize) {
      current = candidate;
    } else {
      chunks.push(current);
      const carry = tailOf(current, overlap);
      current = carry ? `${carry} ${sentence}` : sentence;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
