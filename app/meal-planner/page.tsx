"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/lib/auth";

// ── Opcje formularza ─────────────────────────────────────────────────────────
const GOALS = [
  "Zdrowe odżywianie",
  "Redukcja masy ciała",
  "Utrzymanie wagi",
  "Budowa masy mięśniowej",
  "Więcej energii na co dzień",
];

const DIETS = [
  "Klasyczna (zbilansowana)",
  "Low carb",
  "Wysokobiałkowa",
  "Wegetariańska",
  "Wegańska",
  "Keto",
  "Śródziemnomorska",
  "Bezglutenowa",
  "Bez laktozy",
];

const SEXES = ["Kobieta", "Mężczyzna"];

const ACTIVITIES = [
  "Siedzący tryb życia",
  "Lekka aktywność (1–2 treningi/tydz.)",
  "Umiarkowana (2–3 treningi/tydz.)",
  "Wysoka (4+ treningi/tydz.)",
];

const PACES = ["Zdrowe (1–1,5 kg/tydz.)", "Intensywne (>1,5 kg/tydz.)"];

// Co ile dni robić zakupy — steruje podziałem listy zakupów na bloki.
const SHOPPING = [
  { v: "1", l: "Codziennie" },
  { v: "2", l: "Co 2 dni" },
  { v: "3", l: "Co 3 dni" },
  { v: "4", l: "Co 4 dni" },
  { v: "5", l: "Co 5 dni" },
  { v: "7", l: "Raz w tygodniu (co 7 dni)" },
];

// Cel, przy którym pokazujemy pola redukcji (musi zgadzać się z GOALS).
const GOAL_REDUCTION = "Redukcja masy ciała";

// Pełny stan formularza — jeden „brief" dla agenta.
type PlanForm = {
  goal: string;
  diet: string;
  people: string;
  days: string;
  mealsPerDay: string;
  budget: string;
  shoppingEvery: string;
  // O użytkowniku (opcjonalne — do policzenia zapotrzebowania kalorycznego).
  sex: string;
  age: string;
  weight: string;
  height: string;
  activity: string;
  // Cel redukcji (używane tylko, gdy goal === GOAL_REDUCTION).
  targetLossKg: string;
  pace: string;
  exclusions: string;
  haveAtHome: string;
  preferences: string;
  extraNeeds: string;
  withPortionsCost: boolean;
  onlineSources: boolean;
};

const DEFAULT_FORM: PlanForm = {
  goal: "Zdrowe odżywianie",
  diet: "Klasyczna (zbilansowana)",
  people: "1",
  days: "7",
  mealsPerDay: "3",
  budget: "",
  shoppingEvery: "4",
  sex: "",
  age: "",
  weight: "",
  height: "",
  activity: "Umiarkowana (2–3 treningi/tydz.)",
  targetLossKg: "",
  pace: "Zdrowe (1–1,5 kg/tydz.)",
  exclusions: "",
  haveAtHome: "",
  preferences: "",
  extraNeeds: "",
  withPortionsCost: true,
  onlineSources: false,
};

// Gotowe scenariusze — klik wypełnia CAŁY formularz gotową bazą (bez wysyłki,
// można jeszcze doprecyzować przed generowaniem).
const SCENARIOS: {
  emoji: string;
  title: string;
  meta: string;
  form: Partial<PlanForm>;
}[] = [
  {
    emoji: "👨‍👩‍👧",
    title: "Rodzinny i oszczędny",
    meta: "4 osoby · 7 dni · ~70 zł/dzień",
    form: {
      goal: "Zdrowe odżywianie",
      diet: "Klasyczna (zbilansowana)",
      people: "4",
      days: "7",
      mealsPerDay: "3",
      budget: "70",
      extraNeeds:
        "Tanie i sycące dania dla rodziny (2 dorosłych, 2 dzieci), mało czasu na gotowanie w tygodniu, chętnie meal prep.",
      exclusions: "",
      haveAtHome: "",
      preferences: "",
    },
  },
  {
    emoji: "🥦",
    title: "Wege z dużą ilością białka",
    meta: "1 osoba · 7 dni · ~35 zł/dzień",
    form: {
      goal: "Budowa masy mięśniowej",
      diet: "Wegetariańska",
      people: "1",
      days: "7",
      mealsPerDay: "4",
      budget: "35",
      preferences:
        "Dużo białka roślinnego: strączki, tofu, tempeh, jaja, nabiał, sery.",
      exclusions: "",
      haveAtHome: "",
      extraNeeds: "",
    },
  },
  {
    emoji: "🥛",
    title: "Szybko i bez laktozy",
    meta: "2 osoby · 7 dni · ~60 zł/dzień",
    form: {
      goal: "Utrzymanie wagi",
      diet: "Bez laktozy",
      people: "2",
      days: "7",
      mealsPerDay: "3",
      budget: "60",
      exclusions: "Nietolerancja laktozy — bez mleka, śmietany i twardych serów żółtych.",
      extraNeeds: "Dania do 20 minut, proste składniki.",
      haveAtHome: "",
      preferences: "",
    },
  },
  {
    emoji: "💪",
    title: "Redukcja low-carb",
    meta: "1 osoba · 7 dni · ~30 zł/dzień",
    form: {
      goal: "Redukcja masy ciała",
      diet: "Low carb",
      people: "1",
      days: "7",
      mealsPerDay: "2",
      budget: "30",
      targetLossKg: "5",
      pace: "Zdrowe (1–1,5 kg/tydz.)",
      preferences: "Dużo białka i warzyw, mało cukru.",
      exclusions: "",
      haveAtHome: "",
      extraNeeds: "",
    },
  },
];

type Part = {
  type: string;
  text?: string;
  url?: string;
  title?: string;
  input?: { url?: string; query?: string; expression?: string };
};

// Zapisany plan z bazy.
type SavedPlan = {
  id: string;
  title: string;
  preferences: string | null;
  content: string;
  created_at: string;
};

function messageText(parts: Part[]) {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

// Zbierz unikalne źródła (source-url) zwrócone przez grounding.
function messageSources(parts: Part[]) {
  const seen = new Set<string>();
  const out: { url: string; title: string }[] = [];
  for (const p of parts) {
    if (p.type === "source-url" && p.url && !seen.has(p.url)) {
      seen.add(p.url);
      let label = p.title?.trim() || "";
      if (!label) {
        try {
          label = new URL(p.url).hostname.replace(/^www\./, "");
        } catch {
          label = p.url;
        }
      }
      out.push({ url: p.url, title: label });
    }
  }
  return out;
}

// Ślad pracy agenta: co czyta, czego szuka i co liczy.
function activity(parts: Part[]) {
  const out: string[] = [];
  for (const p of parts) {
    if (p.type === "tool-readWebPage" && p.input?.url) {
      out.push(`📄 Czytam: ${p.input.url}`);
    }
    if (p.type === "tool-searchWikipedia" && p.input?.query) {
      out.push(`📚 Wikipedia: ${p.input.query}`);
    }
    if (p.type === "tool-calculator" && p.input?.expression) {
      out.push(`🧮 Liczę: ${p.input.expression}`);
    }
  }
  return out;
}

// ── Eksport do Word ─────────────────────────────────────────────────────────
// Zamieniamy markdown na HTML zgodny z Wordem i pobieramy jako .doc. Word otwiera
// taki plik natywnie (z tabelami, nagłówkami, linkami), a my nie dokładamy
// żadnej biblioteki. Obsługujemy format, który zwraca agent: nagłówki #..###,
// tabele GFM (|...|), pogrubienia **...**, listy - oraz linki [tekst](url).

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Formatowanie w linii: **pogrubienie** i [tekst](url).
function inline(s: string) {
  let out = escapeHtml(s);
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text, url) => `<a href="${url}">${text}</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  // Goły URL (np. w sekcji Źródła) — zamień na klikalny link.
  out = out.replace(
    /(^|[\s(])(https?:\/\/[^\s)<]+)/g,
    (_m, pre, url) => `${pre}<a href="${url}">${url}</a>`,
  );
  return out;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

// Jeden posiłek sparsowany z bloku dnia.
type Meal = { title: string; skl: string; prep: string };

// Buduje tabelkę JEDNEGO dnia w docelowym układzie: scalona komórka „Dzień N"
// (rowspan), nagłówek posiłku na całą szerokość (colspan) oraz wiersze
// „Składniki:" i „Przygotowanie:". forWord=true → style inline (Word);
// forWord=false → klasy (motyw ciemny ze stylów globalnych).
function buildDayTable(
  shortName: string,
  meals: Meal[],
  forWord: boolean,
): string {
  const rows = meals.length * 3; // każdy posiłek: nagłówek + składniki + przygotowanie
  const dayCell = forWord
    ? ' style="background:#f7f7f7;text-align:center;vertical-align:middle"'
    : ' class="mp-day-name"';
  const headCell = forWord
    ? ' style="background:#eee"'
    : ' class="mp-meal-head"';
  const labelCell = forWord
    ? ' style="white-space:nowrap;width:130px"'
    : ' class="mp-meal-label"';
  const open = forWord
    ? '<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;margin:0 0 6px">'
    : '<table class="mp-day">';

  const out: string[] = ['<div class="mp-day-wrap">', open];
  meals.forEach((m, idx) => {
    const head = `<td colspan="2"${headCell}><b>${inline(m.title)}</b></td>`;
    if (idx === 0) {
      out.push(
        `<tr><td rowspan="${rows}"${dayCell}><b>${inline(shortName)}</b></td>${head}</tr>`,
      );
    } else {
      out.push(`<tr>${head}</tr>`);
    }
    out.push(`<tr><td${labelCell}>Składniki:</td><td>${inline(m.skl || "—")}</td></tr>`);
    out.push(
      `<tr><td${labelCell}>Przygotowanie:</td><td>${inline(m.prep || "—")}</td></tr>`,
    );
  });
  out.push("</table>", "</div>");
  return out.join("\n");
}

// Konwersja markdownu planu na HTML. Bloki „### Dzień N" + „#### posiłek" +
// „Składniki:"/„Przygotowanie:" zamieniamy na tabelkę dnia; reszta (nagłówki,
// listy, tabele GFM, akapity) renderowana standardowo. Ten sam wynik zasila
// widok na stronie (forWord=false) i eksport do Word (forWord=true).
function renderMarkdown(md: string, forWord: boolean): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };
  const isDay = (l: string) => /^###\s+Dzień/i.test(l);

  while (i < lines.length) {
    const line = lines[i];

    // Blok jednego dnia → tabelka.
    if (isDay(line)) {
      closeList();
      const dayTitle = line.replace(/^###\s+/, "").trim();
      const shortName = dayTitle.replace(/\s*\(.*\)\s*$/, "").trim();
      html.push(`<h3>${inline(dayTitle)}</h3>`);
      i++;
      const meals: Meal[] = [];
      while (i < lines.length && !/^##\s/.test(lines[i]) && !isDay(lines[i])) {
        const mh = lines[i].match(/^####\s+(.*)$/);
        if (mh) {
          const meal: Meal = { title: mh[1].trim(), skl: "", prep: "" };
          i++;
          while (
            i < lines.length &&
            !/^####\s/.test(lines[i]) &&
            !/^##\s/.test(lines[i]) &&
            !isDay(lines[i])
          ) {
            const l2 = lines[i];
            const sk = l2.match(
              /^\s*[-*]?\s*\*{0,2}\s*Sk[łl]adniki\s*\*{0,2}\s*:?\s*(.*)$/i,
            );
            const pr = l2.match(
              /^\s*[-*]?\s*\*{0,2}\s*Przygotowanie\s*\*{0,2}\s*:?\s*(.*)$/i,
            );
            if (sk) {
              meal.skl = (meal.skl ? meal.skl + " " : "") + sk[1].trim();
            } else if (pr) {
              meal.prep = (meal.prep ? meal.prep + " " : "") + pr[1].trim();
            } else if (l2.trim() !== "") {
              // linia kontynuacji — dołącz do ostatnio wypełnianego pola
              if (meal.prep) meal.prep += " " + l2.trim();
              else if (meal.skl) meal.skl += " " + l2.trim();
            }
            i++;
          }
          meals.push(meal);
        } else {
          i++; // pomiń luźne linie w bloku dnia
        }
      }
      if (meals.length > 0) html.push(buildDayTable(shortName, meals, forWord));
      continue;
    }

    // Tabela GFM: wiersz | ... | + linia separatora | --- |
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])
    ) {
      closeList();
      const header = splitRow(line);
      i += 2;
      const trows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        trows.push(splitRow(lines[i]));
        i++;
      }
      const topen = forWord
        ? '<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%">'
        : "<table>";
      const th = (c: string) =>
        forWord
          ? `<th style="background:var(--text);text-align:left">${inline(c)}</th>`
          : `<th>${inline(c)}</th>`;
      html.push(topen);
      html.push("<tr>" + header.map(th).join("") + "</tr>");
      for (const r of trows) {
        html.push(
          "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>",
        );
      }
      html.push("</table>");
      continue;
    }

    // Nagłówki
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Lista punktowana
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inline(li[1])}</li>`);
      i++;
      continue;
    }

    // Pusta linia
    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    // Zwykły akapit
    closeList();
    html.push(`<p>${inline(line)}</p>`);
    i++;
  }
  closeList();
  return html.join("\n");
}

function downloadWord(markdown: string, title: string) {
  const body = renderMarkdown(markdown, true);
  const doc = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #111; }
  h1 { font-size: 20pt; } h2 { font-size: 15pt; } h3 { font-size: 13pt; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 6px; vertical-align: top; }
  a { color: #1155cc; }
</style>
</head>
<body>${body}</body>
</html>`;
  const blob = new Blob(["﻿", doc], {
    type: "application/msword;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (title || "plan-posilkow")
    .replace(/[^\p{L}\p{N} _-]+/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  a.href = url;
  a.download = `${safe || "plan-posilkow"}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Budowa briefu i tytułu z formularza ──────────────────────────────────────
function clampInt(v: string, def: number, min: number, max: number) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function buildBrief(f: PlanForm) {
  const people = clampInt(f.people, 1, 1, 20);
  const days = clampInt(f.days, 7, 1, 21);
  const meals = clampInt(f.mealsPerDay, 3, 1, 6);
  // Budżet: traktuj 0 / puste / niepoprawne jako „nie podano" — plan za 0 zł
  // nie miałby sensu.
  const budgetNum = parseInt(f.budget, 10);
  const hasBudget = !Number.isNaN(budgetNum) && budgetNum > 0;

  const na = (s: string) => (s.trim() ? s.trim() : "(nie podano)");

  // Sekcja o użytkowniku — tylko realnie podane dane (aktywność ma sensowny domyślny).
  const personLines = [
    f.sex ? `- Płeć: ${f.sex}` : null,
    f.age.trim() ? `- Wiek: ${f.age.trim()} lat` : null,
    f.weight.trim() ? `- Waga: ${f.weight.trim()} kg` : null,
    f.height.trim() ? `- Wzrost: ${f.height.trim()} cm` : null,
    `- Aktywność fizyczna: ${f.activity}`,
  ]
    .filter(Boolean)
    .join("\n");

  const hasBodyData = !!(f.sex && f.age.trim() && f.weight.trim() && f.height.trim());
  const personBlock = hasBodyData
    ? personLines
    : `${personLines}\n- (brak kompletu danych ciała — oszacuj zapotrzebowanie na podstawie celu i to zaznacz)`;

  // Cel redukcji — tylko dla celu „Redukcja masy ciała".
  const reductionBlock =
    f.goal === GOAL_REDUCTION
      ? `\n\n## CEL REDUKCJI
- Ile kg chcę zrzucić: ${f.targetLossKg.trim() ? `${f.targetLossKg.trim()} kg` : "(nie podano)"}
- Tempo redukcji: ${f.pace}`
      : "";

  return `Ułóż plan posiłków dokładnie według poniższej specyfikacji.

## PODSTAWY PLANU
- Cel: ${f.goal}
- Sposób odżywiania: ${f.diet}
- Liczba osób: ${people}
- Liczba dni: ${days}
- Posiłki na dzień: ${meals}
- Budżet dzienny: ${hasBudget ? `${budgetNum} zł/dzień (na wszystkie osoby łącznie)` : "(nie podano — dobierz rozsądnie)"}
- Zakupy co: ${clampInt(f.shoppingEvery, 4, 1, 14)} dni (podziel listę zakupów na bloki o takiej długości)

## O UŻYTKOWNIKU
${personBlock}${reductionBlock}

## DOPASOWANIE
- Alergie i wykluczenia (TWARDE): ${na(f.exclusions)}
- Co jest już w domu: ${na(f.haveAtHome)}
- Preferencje / co lubię: ${na(f.preferences)}
- Dodatkowe potrzeby: ${na(f.extraNeeds)}

## OPCJE
- Podaj gramatury porcji i orientacyjny koszt: ${f.withPortionsCost ? "TAK" : "NIE"}
- Korzystaj ze źródeł online (Wikipedia / strony) i podaj linki: ${f.onlineSources ? "TAK" : "NIE"}`;
}

function planTitleFrom(f: PlanForm) {
  const people = clampInt(f.people, 1, 1, 20);
  const days = clampInt(f.days, 7, 1, 21);
  return `${f.goal} · ${f.diet} · ${people} os. · ${days} dni`.slice(0, 200);
}

export default function MealPlannerPage() {
  const { user } = useAuth();
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/meal-planner" }),
    [],
  );
  const { messages, sendMessage, status, setMessages } = useChat({ transport });

  const [form, setForm] = useState<PlanForm>(DEFAULT_FORM);
  const [planTitle, setPlanTitle] = useState(""); // tytuł aktualnego planu (do zapisu)
  const [planBrief, setPlanBrief] = useState(""); // pełny brief aktualnego planu
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const previewCloseRef = useRef<HTMLButtonElement>(null);

  // Zapis do bazy.
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Panel "Zapisane plany".
  const [saved, setSaved] = useState<SavedPlan[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [preview, setPreview] = useState<SavedPlan | null>(null);

  const isLoading = status === "submitted" || status === "streaming";

  // Skrót do aktualizacji jednego pola.
  function set<K extends keyof PlanForm>(key: K, value: PlanForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Plan ze strumienia = ostatnia odpowiedź agenta.
  const display = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last) return null;
    const parts = last.parts as Part[];
    return {
      text: messageText(parts),
      sources: messageSources(parts),
      acts: activity(parts),
    };
  }, [messages]);

  const canSave = !!display?.text && !isLoading && !!user && savedId === null;

  // Zjedź do wyniku RAZ — w momencie startu generowania. Nie zależymy od
  // display.text, bo ten rośnie z każdym tokenem i przewijanie szarpałoby widok
  // podczas czytania streamowanego planu.
  useEffect(() => {
    if (isLoading) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isLoading]);

  // Podgląd: zamknięcie klawiszem Esc + zarządzanie focusem — po otwarciu fokus
  // ląduje na „Zamknij", a po zamknięciu wraca na element, który otworzył okno.
  useEffect(() => {
    if (!preview) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    previewCloseRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, [preview]);

  // Wczytaj listę zapisanych planów zalogowanego użytkownika.
  const loadSaved = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("meal_plans")
      .select("id, title, preferences, content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Nie udało się wczytać zapisanych planów.", error);
      return;
    }
    setSaved((data ?? []) as SavedPlan[]);
  }, [user]);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  function generate(f: PlanForm) {
    if (isLoading) return;
    const brief = buildBrief(f);

    setMessages([]); // jeden plan naraz — czyścimy poprzedni
    setSavedId(null);
    setSaveError(null);
    setCopied(false);
    setPlanBrief(brief);
    setPlanTitle(planTitleFrom(f));

    // userId leci do route'a, żeby budżet tokenów (L10 W3) wiedział, czyj to koszt.
    sendMessage({ text: brief }, { body: { userId: user?.id } });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    generate(form);
  }

  // Klik scenariusza wypełnia CAŁY formularz (bez wysyłki — można doprecyzować).
  function useScenario(s: (typeof SCENARIOS)[number]) {
    setForm({ ...DEFAULT_FORM, ...s.form });
    // Delikatnie zaznacz, że formularz się zmienił — przewiń do góry.
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function copyPlan() {
    if (!display?.text) return;
    try {
      await navigator.clipboard.writeText(display.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function savePlan() {
    if (!display?.text || !user || saving) return;
    setSaving(true);
    setSaveError(null);
    const { data, error } = await supabase
      .from("meal_plans")
      .insert({
        user_id: user.id,
        title: planTitle || "Plan posiłków",
        preferences: planBrief.trim() || null,
        content: display.text,
      })
      .select("id, title, preferences, content, created_at")
      .single();
    setSaving(false);
    if (error || !data) {
      console.error("Nie udało się zapisać planu.", error);
      const detail =
        error?.code === "42501"
          ? "brak polityki RLS na tabeli 'meal_plans' — uruchom sekcję RLS z supabase/L08_W4_meal_planner.sql."
          : error?.code === "42P01"
            ? "tabela 'meal_plans' nie istnieje — uruchom migrację supabase/L08_W4_meal_planner.sql."
            : (error?.message ?? "nieznany błąd.");
      setSaveError(`Nie udało się zapisać: ${detail}`);
      return;
    }
    setSavedId(data.id);
    setSaved((prev) => [data as SavedPlan, ...prev]);
  }

  async function deleteSaved(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const { error } = await supabase
      .from("meal_plans")
      .delete()
      .eq("id", id)
      .eq("user_id", user!.id);
    if (error) {
      console.error("Nie udało się usunąć planu.", error);
      return;
    }
    setSaved((prev) => prev.filter((r) => r.id !== id));
    if (preview?.id === id) setPreview(null);
  }

  const daysBadge = clampInt(form.days, 7, 1, 21);

  return (
    <div className="mp-page">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <header className="mp-hero">
        <div className="mp-hero-glow" />
        <div className="mp-hero-main">
          <div className="mp-hero-icon">🍽️</div>
          <div>
            <h1 className="mp-hero-title">Planer posiłków</h1>
            <p className="mp-hero-sub">
              Dopasowany jadłospis, przepisy i lista zakupów w kilka chwil.
            </p>
          </div>
        </div>
        <div className="mp-hero-badge">
          <span className="mp-badge-top">PLAN</span>
          <span className="mp-badge-num">{daysBadge}</span>
          <span className="mp-badge-bot">{daysBadge === 1 ? "DZIEŃ" : "DNI"}</span>
        </div>
      </header>

      {/* ── Generator: formularz + szybki start ───────────────────────── */}
      <div className="mp-generator">
        <form onSubmit={handleSubmit} className="mp-form">
          {/* Sekcja 01 — Podstawy planu */}
          <section className="mp-section">
            <div className="mp-section-head">
              <span className="mp-section-num">01</span>
              <div>
                <div className="mp-section-title">Podstawy planu</div>
                <div className="mp-section-desc">
                  Ustaw zakres i główny kierunek jadłospisu.
                </div>
              </div>
            </div>

            <div className="mp-row-2">
              <label className="mp-field">
                <span className="mp-label">Cel</span>
                <div className="mp-select-wrap">
                  <select
                    value={form.goal}
                    onChange={(e) => set("goal", e.target.value)}
                    className="mp-select"
                  >
                    {GOALS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="mp-field">
                <span className="mp-label">Sposób odżywiania</span>
                <div className="mp-select-wrap">
                  <select
                    value={form.diet}
                    onChange={(e) => set("diet", e.target.value)}
                    className="mp-select"
                  >
                    {DIETS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            </div>

            <div className="mp-nums">
              <label className="mp-num-tile">
                <span className="mp-num-label">OSOBY</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  inputMode="numeric"
                  aria-label="Liczba osób"
                  value={form.people}
                  onChange={(e) => set("people", e.target.value)}
                  className="mp-num-input"
                />
              </label>
              <label className="mp-num-tile">
                <span className="mp-num-label">DNI</span>
                <input
                  type="number"
                  min={1}
                  max={21}
                  inputMode="numeric"
                  aria-label="Liczba dni"
                  value={form.days}
                  onChange={(e) => set("days", e.target.value)}
                  className="mp-num-input"
                />
              </label>
              <label className="mp-num-tile">
                <span className="mp-num-label">POSIŁKI / DZIEŃ</span>
                <input
                  type="number"
                  min={1}
                  max={6}
                  inputMode="numeric"
                  aria-label="Liczba posiłków na dzień"
                  value={form.mealsPerDay}
                  onChange={(e) => set("mealsPerDay", e.target.value)}
                  className="mp-num-input"
                />
              </label>
              <label className="mp-num-tile">
                <span className="mp-num-label">BUDŻET / DZIEŃ</span>
                <div className="mp-num-row">
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    aria-label="Budżet na dzień w złotych"
                    value={form.budget}
                    onChange={(e) => set("budget", e.target.value)}
                    placeholder="60"
                    className="mp-num-input"
                  />
                  <span className="mp-pln">PLN</span>
                </div>
              </label>
            </div>

            <label className="mp-field">
              <span className="mp-label">
                Zakupy co ile dni?{" "}
                <span style={{ color: "var(--muted-dim)", fontWeight: 400 }}>
                  — dla świeżości i mniejszej liczby wizyt w sklepie
                </span>
              </span>
              <div className="mp-select-wrap">
                <select
                  value={form.shoppingEvery}
                  onChange={(e) => set("shoppingEvery", e.target.value)}
                  className="mp-select"
                >
                  {SHOPPING.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          </section>

          {/* Sekcja 02 — O Tobie */}
          <section className="mp-section">
            <div className="mp-section-head">
              <span className="mp-section-num">02</span>
              <div>
                <div className="mp-section-title">O Tobie</div>
                <div className="mp-section-desc">
                  Opcjonalne — dzięki tym danym policzymy Twoje zapotrzebowanie
                  kaloryczne (BMR/TDEE).
                </div>
              </div>
            </div>

            <div className="mp-row-2">
              <label className="mp-field">
                <span className="mp-label">Płeć</span>
                <div className="mp-select-wrap">
                  <select
                    value={form.sex}
                    onChange={(e) => set("sex", e.target.value)}
                    className="mp-select"
                  >
                    <option value="">— wybierz —</option>
                    {SEXES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="mp-field">
                <span className="mp-label">Aktywność fizyczna</span>
                <div className="mp-select-wrap">
                  <select
                    value={form.activity}
                    onChange={(e) => set("activity", e.target.value)}
                    className="mp-select"
                  >
                    {ACTIVITIES.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            </div>

            <div className="mp-nums mp-nums-3">
              <label className="mp-num-tile">
                <span className="mp-num-label">WIEK (LAT)</span>
                <input
                  type="number"
                  min={12}
                  max={100}
                  inputMode="numeric"
                  aria-label="Wiek w latach"
                  value={form.age}
                  onChange={(e) => set("age", e.target.value)}
                  placeholder="30"
                  className="mp-num-input"
                />
              </label>
              <label className="mp-num-tile">
                <span className="mp-num-label">WAGA (KG)</span>
                <input
                  type="number"
                  min={30}
                  max={300}
                  inputMode="numeric"
                  aria-label="Waga w kilogramach"
                  value={form.weight}
                  onChange={(e) => set("weight", e.target.value)}
                  placeholder="70"
                  className="mp-num-input"
                />
              </label>
              <label className="mp-num-tile">
                <span className="mp-num-label">WZROST (CM)</span>
                <input
                  type="number"
                  min={120}
                  max={230}
                  inputMode="numeric"
                  aria-label="Wzrost w centymetrach"
                  value={form.height}
                  onChange={(e) => set("height", e.target.value)}
                  placeholder="175"
                  className="mp-num-input"
                />
              </label>
            </div>

            {form.goal === GOAL_REDUCTION && (
              <div className="mp-reduction">
                <div className="mp-reduction-row">
                  <label className="mp-field">
                    <span className="mp-label">Ile kg chcesz zrzucić?</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      inputMode="numeric"
                      aria-label="Ile kilogramów chcesz zrzucić"
                      value={form.targetLossKg}
                      onChange={(e) => set("targetLossKg", e.target.value)}
                      placeholder="np. 5"
                      className="mp-input-line"
                    />
                  </label>
                  <label className="mp-field">
                    <span className="mp-label">Tempo redukcji</span>
                    <div className="mp-select-wrap">
                      <select
                        value={form.pace}
                        onChange={(e) => set("pace", e.target.value)}
                        className="mp-select"
                      >
                        {PACES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                </div>
                <div className="mp-reduction-hint">
                  ⚖️ Zdrowe tempo to ok. 1–1,5 kg/tydzień. „Intensywne" oznacza
                  większy deficyt — stosuj krótko i nie schodź poniżej bezpiecznego
                  minimum kalorii.
                </div>
              </div>
            )}
          </section>

          {/* Sekcja 03 — Dopasowanie */}
          <section className="mp-section">
            <div className="mp-section-head">
              <span className="mp-section-num">03</span>
              <div>
                <div className="mp-section-title">Dopasowanie</div>
                <div className="mp-section-desc">
                  Najważniejsze informacje dla bezpiecznego i praktycznego planu.
                </div>
              </div>
            </div>

            <div className="mp-row-2">
              <label className="mp-field">
                <span className="mp-label">Alergie i wykluczenia</span>
                <textarea
                  value={form.exclusions}
                  onChange={(e) => set("exclusions", e.target.value)}
                  placeholder="Np. bez orzechów, laktozy i bardzo ostrych dań..."
                  rows={3}
                  className="mp-textarea"
                />
              </label>
              <label className="mp-field">
                <span className="mp-label">Co masz już w domu?</span>
                <textarea
                  value={form.haveAtHome}
                  onChange={(e) => set("haveAtHome", e.target.value)}
                  placeholder="Np. ryż, makaron, oliwa, ciecierzyca..."
                  rows={3}
                  className="mp-textarea"
                />
              </label>
            </div>

            <div className="mp-row-2">
              <label className="mp-field">
                <span className="mp-label">Co lubisz? (preferencje)</span>
                <textarea
                  value={form.preferences}
                  onChange={(e) => set("preferences", e.target.value)}
                  placeholder="Np. kuchnia azjatycka, dużo warzyw, nie przepadam za rybami..."
                  rows={3}
                  className="mp-textarea"
                />
              </label>
              <label className="mp-field">
                <span className="mp-label">Dodatkowe potrzeby</span>
                <textarea
                  value={form.extraNeeds}
                  onChange={(e) => set("extraNeeds", e.target.value)}
                  placeholder="Np. obiady do pracy, gotowanie dwa razy w tygodniu, kolacje do 20 minut..."
                  rows={3}
                  className="mp-textarea"
                />
              </label>
            </div>
          </section>

          {/* Pasek akcji: opcje + CTA */}
          <div className="mp-form-foot">
            <div className="mp-toggles">
              <button
                type="button"
                onClick={() => set("withPortionsCost", !form.withPortionsCost)}
                aria-pressed={form.withPortionsCost}
                className={`mp-toggle ${form.withPortionsCost ? "on" : ""}`}
              >
                📊 Porcje i koszt
              </button>
              <button
                type="button"
                onClick={() => set("onlineSources", !form.onlineSources)}
                aria-pressed={form.onlineSources}
                className={`mp-toggle ${form.onlineSources ? "on" : ""}`}
              >
                🌐 Źródła online
              </button>
            </div>
            <button type="submit" disabled={isLoading} className="mp-cta">
              {isLoading ? "⏳ Układam plan..." : "✨ Ułóż plan posiłków"}
            </button>
          </div>
        </form>

        {/* Szybki start */}
        <aside className="mp-side">
          <span className="mp-eyebrow">SZYBKI START</span>
          <h2 className="mp-side-title">Gotowe scenariusze</h2>
          <p className="mp-side-desc">
            Wybierz bazę i zmień dowolne szczegóły przed wygenerowaniem.
          </p>
          <div className="mp-side-list">
            {SCENARIOS.map((s) => (
              <button
                key={s.title}
                onClick={() => useScenario(s)}
                type="button"
                className="mp-scenario"
              >
                <span className="mp-scenario-emoji">{s.emoji}</span>
                <span className="mp-scenario-body">
                  <span className="mp-scenario-title">{s.title}</span>
                  <span className="mp-scenario-meta">{s.meta}</span>
                </span>
                <span className="mp-scenario-arrow">→</span>
              </button>
            ))}
          </div>
          <div className="mp-note">
            🛡️ Alergie traktujemy jako twarde wykluczenia. Przy diecie leczniczej
            skonsultuj jadłospis ze specjalistą.
          </div>
        </aside>
      </div>

      {/* ── Zapisane plany ────────────────────────────────────────────── */}
      <div className="mp-saved-bar">
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="mp-ghost"
          type="button"
        >
          📁 Zapisane plany {saved.length > 0 ? `(${saved.length})` : ""}{" "}
          {panelOpen ? "▲" : "▼"}
        </button>

        {panelOpen && (
          <div className="mp-saved-list">
            {!user ? (
              <div className="mp-saved-empty">
                Zaloguj się, aby zapisywać i przeglądać plany.
              </div>
            ) : saved.length === 0 ? (
              <div className="mp-saved-empty">
                Brak zapisanych planów. Ułóż plan i kliknij „💾 Zapisz w bazie".
              </div>
            ) : (
              saved.map((r) => (
                <div
                  key={r.id}
                  onClick={() => setPreview(r)}
                  title="Kliknij, aby otworzyć podgląd"
                  className={`mp-saved-row ${preview?.id === r.id ? "active" : ""}`}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mp-saved-title">{r.title}</div>
                    <div className="mp-saved-date">
                      {new Date(r.created_at).toLocaleString("pl-PL")}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadWord(r.content, r.title);
                    }}
                    title="Eksport do Word"
                    className="mp-icon-btn blue"
                  >
                    📝
                  </button>
                  <button
                    onClick={(e) => deleteSaved(r.id, e)}
                    title="Usuń"
                    className="mp-icon-btn red"
                  >
                    🗑
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Wynik ─────────────────────────────────────────────────────── */}
      <div ref={resultRef} className="mp-result">
        {display?.acts && display.acts.length > 0 && (
          <div className="mp-acts">
            {display.acts.map((a, i) => (
              <span key={i} className="mp-act">
                {a}
              </span>
            ))}
          </div>
        )}

        {isLoading && !display?.text && (
          <div className="mp-loading fade-in-up">
            <span className="mp-spinner" /> Agent układa jadłospis, dobiera
            przepisy i liczy kalorie...
          </div>
        )}

        {display?.text && (
          <div className="fade-in-up">
            <div className="mp-actions">
              <button onClick={copyPlan} className={`mp-chip ${copied ? "ok" : ""}`}>
                {copied ? "✅ Skopiowano!" : "📋 Kopiuj plan"}
              </button>
              <button
                onClick={savePlan}
                disabled={!canSave || saving}
                title={!user ? "Zaloguj się, aby zapisać" : undefined}
                className={`mp-chip ${savedId ? "ok" : ""}`}
              >
                {savedId
                  ? "✅ Zapisano w bazie"
                  : saving
                    ? "⏳ Zapisuję..."
                    : "💾 Zapisz w bazie"}
              </button>
              <button
                onClick={() =>
                  downloadWord(display.text, planTitle || "Plan posiłków")
                }
                className="mp-chip"
              >
                📝 Eksport do Word
              </button>
            </div>

            {saveError && <div className="mp-error">⚠️ {saveError}</div>}

            <article className="mp-article">
              <div
                className="markdown"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(display.text, false),
                }}
              />
            </article>

            {display.sources.length > 0 && (
              <div className="mp-sources">
                <span>🔗 Źródła (grounding):</span>
                {display.sources.map((s, i) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {i + 1}. {s.title}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Podgląd zapisanego planu ──────────────────────────────────── */}
      {preview && (
        <div className="mp-modal-bg" onClick={() => setPreview(null)}>
          <div
            className="mp-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Podgląd planu: ${preview.title}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mp-modal-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mp-modal-title" title={preview.title}>
                  🍽️ {preview.title}
                </div>
                <div className="mp-modal-date">
                  {new Date(preview.created_at).toLocaleString("pl-PL")}
                </div>
              </div>
              <button
                onClick={() => downloadWord(preview.content, preview.title)}
                className="mp-chip"
              >
                📝 Word
              </button>
              <button
                ref={previewCloseRef}
                onClick={() => setPreview(null)}
                aria-label="Zamknij"
                className="mp-chip"
              >
                ✕
              </button>
            </div>
            <div className="mp-modal-body">
              <div
                className="markdown"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(preview.content, false),
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Style tabel dziennych (globalne — dotyczą wstrzykiwanego HTML) ── */}
      <style jsx global>{`
        .markdown .mp-day-wrap {
          overflow-x: auto;
          margin: 0 0 10px;
        }
        .markdown table.mp-day {
          display: table;
          width: 100%;
          border-collapse: collapse;
          margin: 0;
          font-size: 14px;
        }
        .markdown table.mp-day td {
          border: 1px solid var(--border-soft);
          padding: 8px 11px;
          vertical-align: top;
          text-align: left;
          background: var(--bg-elev);
        }
        .markdown table.mp-day td.mp-day-name {
          background: var(--ok-bg);
          color: var(--ok-text);
          font-weight: 700;
          text-align: center;
          vertical-align: middle;
          white-space: nowrap;
          width: 64px;
        }
        .markdown table.mp-day td.mp-meal-head {
          background: var(--surface-2);
          color: var(--text);
        }
        .markdown table.mp-day td.mp-meal-label {
          color: var(--muted);
          white-space: nowrap;
          width: 130px;
        }
      `}</style>

      {/* ── Style (scoped) ────────────────────────────────────────────── */}
      <style jsx>{`
        .mp-page {
          max-width: 1060px;
          margin: 0 auto;
          padding: 20px 16px 48px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        /* Hero */
        .mp-hero {
          position: relative;
          overflow: hidden;
          border-radius: 20px;
          border: 1px solid var(--hero-border);
          background: var(--hero-grad);
          padding: 26px 26px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        .mp-hero-glow {
          position: absolute;
          top: -60%;
          right: -10%;
          width: 380px;
          height: 380px;
          background: radial-gradient(circle, rgba(52, 211, 153, 0.28), transparent 62%);
          pointer-events: none;
        }
        .mp-hero-main {
          display: flex;
          align-items: center;
          gap: 16px;
          position: relative;
          z-index: 1;
        }
        .mp-hero-icon {
          font-size: 40px;
          line-height: 1;
          filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.4));
        }
        .mp-hero-title {
          font-size: 32px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: var(--text);
          margin: 0;
        }
        .mp-hero-sub {
          margin: 4px 0 0;
          font-size: 14px;
          color: var(--ok-text);
        }
        .mp-hero-badge {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-width: 96px;
          padding: 12px 18px;
          border-radius: 16px;
          border: 1px solid rgba(52, 211, 153, 0.35);
          background: rgba(6, 24, 18, 0.55);
        }
        .mp-badge-top,
        .mp-badge-bot {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2px;
          color: var(--ok-text);
        }
        .mp-badge-num {
          font-size: 34px;
          font-weight: 800;
          color: var(--text);
          line-height: 1.1;
        }

        /* Generator layout */
        .mp-generator {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 300px;
          gap: 16px;
          align-items: start;
        }

        /* Formularz */
        .mp-form {
          border-radius: 18px;
          border: 1px solid var(--border-soft);
          background: linear-gradient(180deg, var(--surface-3) 0%, var(--bg-elev) 100%);
          padding: 22px 24px;
          display: flex;
          flex-direction: column;
          gap: 26px;
        }
        .mp-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .mp-section-head {
          display: flex;
          gap: 12px;
          align-items: center;
        }
        .mp-section-num {
          flex-shrink: 0;
          width: 34px;
          height: 34px;
          display: grid;
          place-items: center;
          border-radius: 10px;
          background: rgba(52, 211, 153, 0.12);
          border: 1px solid rgba(52, 211, 153, 0.35);
          color: var(--accent-green);
          font-size: 13px;
          font-weight: 800;
        }
        .mp-section-title {
          font-size: 17px;
          font-weight: 700;
          color: var(--text);
        }
        .mp-section-desc {
          font-size: 13px;
          color: var(--muted);
          margin-top: 2px;
        }
        .mp-row-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        .mp-field {
          display: flex;
          flex-direction: column;
          gap: 7px;
          min-width: 0;
        }
        .mp-label {
          font-size: 13px;
          font-weight: 700;
          color: var(--muted-strong);
        }
        .mp-select-wrap {
          position: relative;
        }
        .mp-select-wrap::after {
          content: "▾";
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
          color: var(--ok-text);
          font-size: 13px;
        }
        .mp-select {
          width: 100%;
          appearance: none;
          -webkit-appearance: none;
          background: var(--bg);
          border: 1px solid var(--surface-2);
          border-radius: 12px;
          color: var(--text);
          padding: 12px 34px 12px 14px;
          font-size: 15px;
          font-family: inherit;
          outline: none;
          cursor: pointer;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .mp-select:focus {
          border-color: var(--accent-green);
          box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.12);
        }

        .mp-nums {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }
        .mp-nums-3 {
          grid-template-columns: repeat(3, 1fr);
        }
        .mp-num-tile {
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: var(--bg);
          border: 1px solid var(--surface-2);
          border-radius: 14px;
          padding: 12px 14px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .mp-num-tile:focus-within {
          border-color: var(--accent-green);
          box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.12);
        }
        .mp-num-label {
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 1px;
          color: var(--muted-dim);
        }
        .mp-num-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .mp-num-input {
          width: 100%;
          min-width: 0;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text);
          font-size: 22px;
          font-weight: 700;
          font-family: inherit;
          padding: 0;
        }
        .mp-num-input::placeholder {
          color: var(--muted);
        }
        .mp-pln {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 1px;
          color: var(--accent-green);
          flex-shrink: 0;
        }

        .mp-textarea {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--surface-2);
          border-radius: 12px;
          color: var(--text);
          padding: 12px 14px;
          font-size: 14px;
          line-height: 1.55;
          outline: none;
          resize: vertical;
          font-family: inherit;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .mp-textarea::placeholder {
          color: var(--muted);
        }
        .mp-textarea:focus {
          border-color: var(--accent-green);
          box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.12);
        }

        /* Pojedyncza linia (np. „ile kg zrzucić") — wygląd jak select. */
        .mp-input-line {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--surface-2);
          border-radius: 12px;
          color: var(--text);
          padding: 12px 14px;
          font-size: 15px;
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .mp-input-line::placeholder {
          color: var(--muted);
        }
        .mp-input-line:focus {
          border-color: var(--accent-green);
          box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.12);
        }

        /* Blok celu redukcji */
        .mp-reduction {
          display: flex;
          flex-direction: column;
          gap: 10px;
          border: 1px dashed rgba(52, 211, 153, 0.4);
          background: rgba(52, 211, 153, 0.04);
          border-radius: 14px;
          padding: 14px;
        }
        .mp-reduction-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        .mp-reduction-hint {
          font-size: 12px;
          color: var(--ok-text);
          line-height: 1.5;
        }

        .mp-form-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          border-top: 1px solid var(--border-soft);
          padding-top: 18px;
        }
        .mp-toggles {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .mp-toggle {
          background: var(--bg-elev);
          border: 1px solid var(--surface-2);
          border-radius: 999px;
          color: var(--muted-strong);
          padding: 8px 14px;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .mp-toggle:hover {
          border-color: var(--border-2);
        }
        .mp-toggle.on {
          background: rgba(52, 211, 153, 0.12);
          border-color: rgba(52, 211, 153, 0.55);
          color: var(--ok-text);
        }
        .mp-cta {
          flex-shrink: 0;
          background: linear-gradient(135deg, var(--accent-green) 0%, #10b981 100%);
          border: none;
          border-radius: 12px;
          color: var(--accent-fg);
          font-weight: 800;
          font-size: 15px;
          padding: 13px 26px;
          cursor: pointer;
          box-shadow: 0 8px 22px rgba(16, 185, 129, 0.28);
          transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
        }
        .mp-cta:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 12px 28px rgba(16, 185, 129, 0.4);
        }
        .mp-cta:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          box-shadow: none;
        }

        /* Szybki start */
        .mp-side {
          border-radius: 18px;
          border: 1px solid var(--border-soft);
          background: linear-gradient(180deg, var(--surface-3) 0%, var(--bg-elev) 100%);
          padding: 20px 18px;
          position: sticky;
          top: 16px;
        }
        .mp-eyebrow {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2px;
          color: var(--accent-green);
        }
        .mp-side-title {
          font-size: 18px;
          font-weight: 700;
          color: var(--text);
          margin: 6px 0 3px;
        }
        .mp-side-desc {
          font-size: 12.5px;
          color: var(--muted);
          margin: 0 0 14px;
          line-height: 1.5;
        }
        .mp-side-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .mp-scenario {
          display: flex;
          align-items: center;
          gap: 11px;
          text-align: left;
          background: var(--bg-elev);
          border: 1px solid var(--surface-2);
          border-radius: 14px;
          padding: 12px 13px;
          cursor: pointer;
          color: inherit;
          transition: border-color 0.15s ease, transform 0.15s ease, background 0.15s ease;
        }
        .mp-scenario:hover {
          border-color: var(--accent-green);
          background: var(--ok-bg);
          transform: translateY(-2px);
        }
        .mp-scenario-emoji {
          font-size: 19px;
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 11px;
          background: rgba(52, 211, 153, 0.1);
          border: 1px solid rgba(52, 211, 153, 0.22);
        }
        .mp-scenario-body {
          display: flex;
          flex-direction: column;
          min-width: 0;
          flex: 1;
        }
        .mp-scenario-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text);
        }
        .mp-scenario-meta {
          font-size: 11.5px;
          color: var(--muted);
          margin-top: 2px;
        }
        .mp-scenario-arrow {
          color: var(--accent-green);
          font-size: 17px;
          opacity: 0.7;
          transition: transform 0.15s ease;
        }
        .mp-scenario:hover .mp-scenario-arrow {
          transform: translateX(3px);
          opacity: 1;
        }
        .mp-note {
          margin-top: 14px;
          font-size: 12px;
          color: var(--warn-text);
          background: rgba(191, 149, 63, 0.08);
          border: 1px solid rgba(191, 149, 63, 0.28);
          border-radius: 12px;
          padding: 11px 13px;
          line-height: 1.5;
        }

        /* Zapisane plany */
        .mp-ghost {
          background: transparent;
          border: 1px solid var(--surface-2);
          border-radius: 10px;
          color: var(--muted-strong);
          padding: 8px 14px;
          font-size: 13px;
          cursor: pointer;
          transition: border-color 0.15s ease;
        }
        .mp-ghost:hover {
          border-color: var(--border-2);
        }
        .mp-saved-list {
          margin-top: 10px;
          border: 1px solid var(--surface-2);
          border-radius: 12px;
          overflow: hidden;
        }
        .mp-saved-empty {
          padding: 14px 16px;
          color: var(--muted);
          font-size: 13px;
        }
        .mp-saved-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 11px 14px;
          border-bottom: 1px solid var(--border-soft);
          cursor: pointer;
          transition: background 0.12s ease;
        }
        .mp-saved-row:last-child {
          border-bottom: none;
        }
        .mp-saved-row:hover,
        .mp-saved-row.active {
          background: var(--surface-3);
        }
        .mp-saved-title {
          font-size: 14px;
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .mp-saved-date {
          font-size: 11px;
          color: var(--muted);
          margin-top: 1px;
        }
        .mp-icon-btn {
          background: transparent;
          border-radius: 7px;
          padding: 3px 9px;
          font-size: 12px;
          cursor: pointer;
        }
        .mp-icon-btn.blue {
          border: 1px solid var(--border-2);
          color: var(--accent-link);
        }
        .mp-icon-btn.red {
          border: 1px solid var(--danger-border);
          color: var(--danger-text);
        }

        /* Wynik */
        .mp-result {
          display: flex;
          flex-direction: column;
          gap: 12px;
          scroll-margin-top: 16px;
        }
        .mp-acts {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .mp-act {
          font-size: 11px;
          color: var(--muted-strong);
          background: rgba(52, 211, 153, 0.08);
          border: 1px solid rgba(52, 211, 153, 0.4);
          border-radius: 999px;
          padding: 3px 12px;
          align-self: flex-start;
        }
        .mp-loading {
          align-self: flex-start;
          display: flex;
          align-items: center;
          gap: 10px;
          background: var(--surface-3);
          border: 1px solid var(--surface-2);
          border-radius: 12px;
          padding: 12px 16px;
          color: var(--muted);
          font-size: 14px;
        }
        .mp-spinner {
          width: 15px;
          height: 15px;
          border-radius: 50%;
          border: 2px solid rgba(52, 211, 153, 0.25);
          border-top-color: var(--accent-green);
          animation: mp-spin 0.7s linear infinite;
          display: inline-block;
        }
        @keyframes mp-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .mp-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
          margin-bottom: 12px;
        }
        .mp-chip {
          background: var(--surface-3);
          border: 1px solid var(--surface-2);
          border-radius: 9px;
          color: var(--text);
          padding: 7px 15px;
          font-size: 13px;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .mp-chip:hover:not(:disabled) {
          border-color: var(--border-2);
        }
        .mp-chip:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .mp-chip.ok {
          background: rgba(52, 211, 153, 0.1);
          border-color: rgba(52, 211, 153, 0.5);
          color: var(--ok-text);
        }
        .mp-error {
          background: var(--danger-bg);
          border: 1px solid var(--danger-border);
          border-radius: 10px;
          color: var(--danger-text);
          padding: 9px 13px;
          font-size: 13px;
          margin-bottom: 12px;
        }
        .mp-article {
          background: linear-gradient(180deg, var(--surface-3) 0%, var(--bg-elev) 100%);
          border: 1px solid var(--surface-2);
          border-radius: 16px;
          padding: 22px 26px;
          line-height: 1.65;
          overflow-wrap: anywhere;
        }
        .mp-sources {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          color: var(--muted);
          padding-left: 2px;
          margin-top: 12px;
        }
        .mp-sources a {
          color: var(--accent-green);
          text-decoration: none;
        }

        /* Modal */
        .mp-modal-bg {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.72);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          z-index: 200;
        }
        .mp-modal {
          background: var(--bg-elev);
          border: 1px solid var(--surface-2);
          border-radius: 16px;
          width: 100%;
          max-width: 840px;
          max-height: 88vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.65);
        }
        .mp-modal-head {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 15px 20px;
          border-bottom: 1px solid var(--border-soft);
          flex-shrink: 0;
        }
        .mp-modal-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .mp-modal-date {
          font-size: 11px;
          color: var(--muted);
          margin-top: 1px;
        }
        .mp-modal-body {
          overflow-y: auto;
          padding: 20px 26px;
          line-height: 1.65;
          overflow-wrap: anywhere;
        }

        /* Responsywność */
        @media (max-width: 900px) {
          .mp-generator {
            grid-template-columns: 1fr;
          }
          .mp-side {
            position: static;
          }
        }
        @media (max-width: 620px) {
          .mp-hero {
            flex-direction: column;
            align-items: flex-start;
            padding: 22px 20px;
          }
          .mp-hero-title {
            font-size: 26px;
          }
          .mp-hero-badge {
            flex-direction: row;
            gap: 8px;
            min-width: 0;
            align-self: stretch;
          }
          .mp-badge-num {
            font-size: 22px;
          }
          .mp-row-2 {
            grid-template-columns: 1fr;
          }
          .mp-nums,
          .mp-nums-3 {
            grid-template-columns: repeat(2, 1fr);
          }
          .mp-reduction-row {
            grid-template-columns: 1fr;
          }
          .mp-form-foot {
            flex-direction: column;
            align-items: stretch;
          }
          .mp-cta {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
