// Wyciąganie cytowanych źródeł ze stopki odpowiedzi agenta.
//
// Agent kończy odpowiedź z bazy wiedzy linią "📎 Źródło: Cennik 2026".
// UI pokazuje ją jako osobny element pod dymkiem, więc trzeba ją odciąć od
// treści — inaczej byłaby raz w tekście, raz w stopce.

export type ParsedAnswer = {
  body: string; // odpowiedź bez linii ze źródłami
  sources: string[]; // unikalne tytuły dokumentów
};

// Model bywa kreatywny w formatowaniu: pogrubia stopkę (**📎 Źródło:**),
// robi z niej cytat (> 📎 …) albo punkt listy (- 📎 …). Wszystkie te ozdobniki
// przepuszczamy, bo liczy się tytuł dokumentu.
const SOURCE_LINE =
  /^[\s>*_-]*📎[\s*_]*Źród(?:ło|ła)[\s*_]*:[\s*_]*(.+?)[\s*_]*$/u;

// Tytuły w jednej linii: "Cennik 2026, FAQ" albo "Cennik 2026 oraz FAQ".
function splitTitles(raw: string): string[] {
  return raw
    .split(/\s*(?:,|;|\soraz\s|\si\s)\s*/u)
    .map((title) =>
      title
        // Ozdobniki markdown i nawiasy kwadratowe z szablonu "[tytuł dokumentu]".
        .replace(/[[\]*_`]/g, "")
        // Kropka kończąca zdanie nie należy do tytułu.
        .replace(/\.\s*$/u, "")
        .trim(),
    )
    .filter(Boolean);
}

export function parseSources(text: string): ParsedAnswer {
  const lines = text.split("\n");
  const sources: string[] = [];

  // Stopka stoi na końcu — zdejmujemy linie od dołu, dopóki pasują do wzorca.
  // Pętla, bo agent potrafi rozbić kilka źródeł na osobne linie.
  while (lines.length > 0) {
    const line = lines[lines.length - 1];

    if (!line.trim()) {
      lines.pop();
      continue;
    }

    const match = line.match(SOURCE_LINE);
    if (!match) break;

    lines.pop();
    sources.unshift(...splitTitles(match[1]));
  }

  return {
    body: lines.join("\n").trimEnd(),
    sources: [...new Set(sources)],
  };
}
