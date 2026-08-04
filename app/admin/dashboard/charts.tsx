"use client";

// Wykresy dashboardu (Lekcja 11, Warsztat 2) — czyste SVG, bez recharts.
//
// Warsztat dopuszcza recharts, Chart.js albo własne SVG. Trzy wykresy o
// kilkunastu punktach danych nie są warte kilkuset kilobajtów zależności
// doładowywanej do przeglądarki; poniższe komponenty rysują je kilkoma tagami
// i skalują się przez viewBox, więc działają na telefonie tak samo jak na
// monitorze.
//
// Kolory i rozmiary siedzą w atrybutach SVG (fill, font-size), a nie w klasach
// CSS: styled-jsx scope'uje style do KOMPONENTU, w którym stoi znacznik <style>,
// więc reguła napisana obok nie objęłaby elementów rysowanych przez pomocnicze
// komponenty niżej. Atrybut działa zawsze.

export const CHART_COLORS = [
  "#5b6cff",
  "#3fb6a8",
  "#e0a63c",
  "#e05a5a",
  "#9a6cff",
  "#6ecf9a",
  "#e07ab0",
];

const INK = "#8a8a9a"; // podpisy osi X
const INK_DIM = "#6a6a7a"; // podpisy osi Y
const GRID = "#23233a";

type Point = { label: string; value: number; hint?: string };

// Skala osi Y: zaokrąglamy maksimum w górę do "ładnej" liczby, żeby siatka
// miała sens — przy surowym maksimum najwyższy punkt zawsze dotykałby górnej
// krawędzi i nie dało się porównać dwóch dni na oko.
//
// Drabinka jest gęsta (nie tylko 1–2–5), bo przy trzech stopniach 21 400
// wskakiwało na oś do 50 000 i wykres zajmował dolną połowę kratki. Połowa
// skali musi zostać okrągła — to podpis środkowej linii siatki.
const STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / pow;
  const step = STEPS.find((s) => norm <= s) ?? 10;
  return step * pow;
}

// Skrót liczby na podpis. Ułamek dokładamy tylko wtedy, gdy naprawdę jest —
// inaczej środek osi 0…25k podpisywał się jako "13k" zamiast "12.5k".
function short(n: number): string {
  const unit = (v: number, suffix: string) =>
    `${Number.isInteger(v) ? v : v.toFixed(1)}${suffix}`;
  if (n >= 1_000_000) return unit(n / 1_000_000, "M");
  if (n >= 1_000) return unit(n / 1_000, "k");
  return String(Math.round(n));
}

const W = 640;
const H = 240;
const PAD = { top: 16, right: 12, bottom: 30, left: 46 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

// Wspólne proporcje: viewBox skaluje rysunek, szerokość bierze się z rodzica.
const svgStyle = { width: "100%", height: "auto", display: "block" } as const;

// ── Wykres liniowy — trend w czasie ─────────────────────────────────────────
export function LineChart({
  points,
  color = CHART_COLORS[0],
}: {
  points: Point[];
  color?: string;
}) {
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  // Punkty rozstawiamy równo od lewej do prawej krawędzi. Przy jednym punkcie
  // dzielenie przez (n-1) dałoby NaN i wykres zniknąłby bez śladu — stąd
  // osobny przypadek na środek.
  const x = (i: number) =>
    PAD.left + (points.length === 1 ? PLOT_W / 2 : (i * PLOT_W) / (points.length - 1));
  const y = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H;

  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  // Wypełnienie pod linią: ta sama ścieżka domknięta do osi X.
  const area = `${x(0)},${PAD.top + PLOT_H} ${line} ${x(points.length - 1)},${
    PAD.top + PLOT_H
  }`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={svgStyle} role="img">
      <Grid max={max} />
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2.5} />
      {points.map((p, i) => (
        <g key={p.label}>
          <circle
            cx={x(i)}
            cy={y(p.value)}
            r={4}
            fill="#0e0e16"
            stroke={color}
            strokeWidth={2}
          >
            <title>{p.hint ?? `${p.label}: ${p.value}`}</title>
          </circle>
          {/* Skrajne podpisy przyklejamy do krawędzi wykresu, nie centrujemy
              na punkcie — wyśrodkowana data ostatniego dnia wychodziła poza
              viewBox i kończyła się uciętym "śr 04.0". */}
          <text
            x={x(i)}
            y={H - 10}
            fill={INK}
            fontSize={11}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
          >
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Wykres słupkowy — ile czegoś danego dnia ────────────────────────────────
export function BarChart({
  points,
  color = CHART_COLORS[1],
}: {
  points: Point[];
  color?: string;
}) {
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const slot = PLOT_W / Math.max(1, points.length);
  const barW = Math.min(46, slot * 0.6);
  const y = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={svgStyle} role="img">
      <Grid max={max} />
      {points.map((p, i) => {
        const cx = PAD.left + slot * i + slot / 2;
        const top = y(p.value);
        return (
          <g key={p.label}>
            <rect
              x={cx - barW / 2}
              y={p.value === 0 ? PAD.top + PLOT_H - 2 : top}
              width={barW}
              // Zero rysujemy jako kreskę 2 px zamiast prostokąta o zerowej
              // wysokości — inaczej pusty dzień nie różni się od brakującego.
              height={p.value === 0 ? 2 : PAD.top + PLOT_H - top}
              rx={5}
              fill={color}
              opacity={p.value === 0 ? 0.25 : 1}
            >
              <title>{p.hint ?? `${p.label}: ${p.value}`}</title>
            </rect>
            {p.value > 0 && (
              <text x={cx} y={top - 6} fill="#c5c5d5" fontSize={11} textAnchor="middle">
                {short(p.value)}
              </text>
            )}
            <text x={cx} y={H - 10} fill={INK} fontSize={11} textAnchor="middle">
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Pierścień — udział w całości ────────────────────────────────────────────
// Rysowany obwodem koła (stroke-dasharray), nie ścieżkami łuków: jeden endpoint
// zjadający 100% to wtedy zwykłe pełne koło, a nie łuk 360°, którego SVG nie
// potrafi narysować jedną krzywą.
export function DonutChart({
  slices,
  total,
  centerLabel,
  centerNote,
}: {
  slices: { label: string; value: number }[];
  total: number;
  centerLabel: string;
  centerNote: string;
}) {
  const R = 62;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 160 160" className="donut" role="img">
        <circle cx={80} cy={80} r={R} fill="none" stroke="#1e1e2e" strokeWidth={22} />
        {slices.map((s, i) => {
          const share = total > 0 ? s.value / total : 0;
          const len = share * C;
          const el = (
            <circle
              key={s.label}
              cx={80}
              cy={80}
              r={R}
              fill="none"
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={22}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              // Start od godziny 12, nie od 3 — tak czyta się wykresy kołowe.
              transform="rotate(-90 80 80)"
            >
              <title>{`${s.label}: ${Math.round(share * 100)}%`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
        <text x={80} y={78} fill="#f0f0f5" fontSize={19} fontWeight={700} textAnchor="middle">
          {centerLabel}
        </text>
        <text x={80} y={95} fill={INK} fontSize={9} textAnchor="middle" letterSpacing="0.08em">
          {centerNote}
        </text>
      </svg>

      <ul className="legend">
        {slices.map((s, i) => (
          <li key={s.label}>
            <span
              className="dot"
              style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
            />
            <span className="legend-label" title={s.label}>
              {s.label}
            </span>
            <span className="legend-value">
              {total > 0 ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>

      <style jsx>{`
        .donut-wrap {
          display: flex;
          align-items: center;
          gap: 24px;
          flex-wrap: wrap;
        }
        .donut {
          width: 190px;
          height: 190px;
          flex-shrink: 0;
        }
        .legend {
          list-style: none;
          margin: 0;
          padding: 0;
          flex: 1;
          min-width: 200px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .legend li {
          display: grid;
          grid-template-columns: 10px minmax(0, 1fr) auto;
          align-items: center;
          gap: 10px;
          font-size: 13px;
        }
        .dot {
          width: 10px;
          height: 10px;
          border-radius: 3px;
        }
        .legend-label {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #c5c5d5;
        }
        .legend-value {
          color: #8a8a9a;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}

// Siatka pozioma + podpisy osi Y (0, połowa, maksimum).
function Grid({ max }: { max: number }) {
  return (
    <g>
      {[0, 0.5, 1].map((f) => {
        const y = PAD.top + PLOT_H - f * PLOT_H;
        return (
          <g key={f}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 8} y={y + 4} fill={INK_DIM} fontSize={11} textAnchor="end">
              {short(max * f)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
