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
        color: "#777",
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
            color: "#9ca3af",
            textDecoration: "none",
            border: "1px solid #2a2a2a",
            borderRadius: 999,
            padding: "2px 9px",
            background: "#141414",
          }}
        >
          📄 {title}
        </Link>
      ))}
    </div>
  );
}
