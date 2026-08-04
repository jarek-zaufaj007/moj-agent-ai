"use client";

// Panel diagnostyczny / bezpieczeństwa dla agentów ReAct i podróży.
// Pokazuje: postęp kroków, użyte narzędzia (z liczbą wywołań), błędy, czas i status.

type DiagPart = {
  type: string;
  toolName?: string;
  state?: string;
  input?: Record<string, unknown>;
  output?: unknown;
};

function toolNameOf(p: DiagPart): string | null {
  if (p.type === "dynamic-tool") return p.toolName ?? null;
  if (p.type.startsWith("tool-")) return p.type.slice("tool-".length);
  return null;
}

function toolDetail(input?: Record<string, unknown>): string {
  if (!input) return "";
  const keys = ["city", "currency", "query", "expression", "url", "title", "countryCode"];
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

// Wykryj błąd w wyniku narzędzia (obiekt z polem error lub tekst błędu).
function outputError(output: unknown): string | null {
  if (output && typeof output === "object" && "error" in output) {
    const e = (output as { error?: unknown }).error;
    if (typeof e === "string" && e) return e;
  }
  if (typeof output === "string" && /błąd|nie udało|timeout|nie znalaz/i.test(output)) {
    return output;
  }
  return null;
}

export type DiagnosticsProps = {
  parts: {
    type: string;
    toolName?: string;
    state?: string;
    input?: Record<string, unknown>;
    output?: unknown;
    text?: string;
  }[];
  isLoading: boolean;
  elapsed: number;
  // Twardy limit iteracji agenta (stopWhen w endpointcie) — do wykrycia limitu.
  hardLimit?: number;
  maxSteps?: number;
};

export function Diagnostics({
  parts,
  isLoading,
  elapsed,
  hardLimit = 8,
  maxSteps = 5,
}: DiagnosticsProps) {
  const counts = new Map<string, number>();
  const errors: { name: string; detail: string; message: string }[] = [];

  // Rzeczywista liczba kroków agenta = liczba markerów "step-start".
  let stepStarts = 0;
  let lastToolIdx = -1;
  let lastTextIdx = -1;

  parts.forEach((p, idx) => {
    if (p.type === "step-start") stepStarts++;
    const pd = p as DiagPart;
    const name = toolNameOf(pd);
    if (name) {
      lastToolIdx = idx;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      const err = outputError(pd.output);
      if (err) errors.push({ name, detail: toolDetail(pd.input), message: err });
    } else if (p.type === "text" && p.text && p.text.trim()) {
      lastTextIdx = idx;
    }
  });

  // Fallback: gdy brak markerów step-start, użyj liczby wywołań narzędzi.
  const rawSteps = stepStarts || [...counts.values()].reduce((a, b) => a + b, 0);
  const clampedSteps = Math.min(Math.max(rawSteps, isLoading ? 1 : 0), maxSteps);
  const ratio = clampedSteps / maxSteps;

  // Kolor paska: 1-3 zielony, 4 żółty, 5 czerwony.
  const barColor =
    clampedSteps >= maxSteps ? "#ef4444" : clampedSteps >= 4 ? "var(--warn-text)" : "#22c55e";

  // Limit osiągnięty tylko gdy agent WYCZERPAŁ twardy limit iteracji i nie
  // zakończył końcową odpowiedzią tekstową (ostatni krok to wywołanie narzędzia).
  const hitHardLimit = rawSteps >= hardLimit && lastTextIdx < lastToolIdx;

  const status = isLoading
    ? { text: "W trakcie...", color: "var(--warn-text)", icon: "⏳" }
    : hitHardLimit
      ? { text: "Limit kroków", color: "#ef4444", icon: "⚠️" }
      : { text: "Zadanie ukończone", color: "#22c55e", icon: "✅" };

  const toolList = [...counts.entries()]
    .map(([name, n]) => `${name}(${n})`)
    .join(", ");

  return (
    <section
      style={{
        border: "1px solid var(--border-2)",
        borderRadius: 12,
        background: "var(--bg-elev)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 700, color: "var(--muted-strong)" }}>🛡️ Diagnostyka</div>

      {/* Pasek kroków */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--muted-strong)", minWidth: 52 }}>Kroki:</span>
        <div
          style={{
            flex: 1,
            height: 8,
            background: "var(--surface)",
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${ratio * 100}%`,
              background: barColor,
              transition: "width 0.3s ease",
            }}
          />
        </div>
        <span style={{ color: "var(--muted-strong)", minWidth: 34, textAlign: "right" }}>
          {clampedSteps}/{maxSteps}
        </span>
      </div>

      {/* Narzędzia */}
      <div style={{ color: "var(--muted-strong)" }}>
        Narzędzia:{" "}
        <span style={{ color: "var(--muted-strong)" }}>{toolList || "—"}</span>
      </div>

      {/* Błędy + czas */}
      <div style={{ display: "flex", gap: 16 }}>
        <span style={{ color: errors.length ? "var(--danger-text)" : "var(--muted-strong)" }}>
          Błędy: {errors.length}
        </span>
        <span style={{ color: "var(--muted-strong)" }}>Czas: {elapsed.toFixed(1)}s</span>
      </div>

      {/* Status */}
      <div style={{ color: status.color, fontWeight: 600 }}>
        {status.icon} Status: {status.text}
      </div>

      {/* Alerty błędów narzędzi */}
      {errors.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {errors.map((e, i) => (
            <div
              key={i}
              style={{
                background: "var(--danger-bg)",
                border: "1px solid var(--danger-border)",
                borderRadius: 8,
                color: "var(--danger-text)",
                padding: "6px 10px",
                fontSize: 12,
              }}
            >
              🔴 {e.name}
              {e.detail ? `("${e.detail}")` : ""} — {e.message}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
