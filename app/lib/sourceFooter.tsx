"use client";

import Link from "next/link";

// Stopka z cytowanymi źródłami — pokazuje, z którego dokumentu pochodzi
// odpowiedź agenta. Klikalna: prowadzi do /knowledge z podglądem fragmentów
// tego dokumentu, więc każdą odpowiedź da się zweryfikować u źródła.
export function SourceFooter({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        marginTop: 6,
        paddingLeft: 2,
        fontSize: 12,
        color: "var(--muted-dim)",
      }}
    >
      <span aria-hidden>📎</span>
      <span>{sources.length === 1 ? "Źródło:" : "Źródła:"}</span>
      {sources.map((title) => (
        <Link
          key={title}
          href={`/knowledge?doc=${encodeURIComponent(title)}`}
          title={`Zobacz fragmenty dokumentu "${title}" w bazie wiedzy`}
          style={{
            color: "var(--muted)",
            textDecoration: "none",
            border: "1px solid var(--border-soft)",
            borderRadius: 999,
            padding: "2px 9px",
            background: "var(--surface-3)",
          }}
        >
          📄 {title}
        </Link>
      ))}
    </div>
  );
}
