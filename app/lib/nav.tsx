"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

// Pełna nawigacja — 14 stron. Dashboard 🏠 na górze.
const ROUTES = [
  { href: "/", emoji: "🏠", label: "Dashboard" },
  { href: "/chat", emoji: "💬", label: "Chat" },
  { href: "/history", emoji: "📜", label: "Historia" },
  { href: "/upload", emoji: "📚", label: "Baza wiedzy" },
  { href: "/knowledge", emoji: "🔍", label: "Podgląd bazy" },
  { href: "/react", emoji: "🔄", label: "Agent ReAct" },
  { href: "/travel", emoji: "✈️", label: "Podróże" },
  { href: "/agent", emoji: "🤖", label: "Agent multi-tool" },
  { href: "/think", emoji: "🧠", label: "Myślenie" },
  { href: "/fewshot", emoji: "📚", label: "Słownik AI" },
  { href: "/format", emoji: "📐", label: "Formater" },
  { href: "/search", emoji: "🌐", label: "Szukaj" },
  { href: "/generate", emoji: "🎨", label: "Grafiki" },
  { href: "/vision", emoji: "👁️", label: "Vision" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      {/* Górny pasek z hamburgerem — tylko na telefonie */}
      <div className="nav-topbar">
        <button
          className="hamburger"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
        >
          ☰
        </button>
        <span>🤖 Mój Agent</span>
      </div>

      {/* Przyciemnienie tła przy otwartym menu (mobile) */}
      <div
        className={`nav-backdrop ${open ? "show" : ""}`}
        onClick={close}
      />

      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-brand">🤖 Mój Agent</div>
        {ROUTES.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            onClick={close}
            className={`nav-link ${isActive(pathname, r.href) ? "active" : ""}`}
          >
            <span>{r.emoji}</span>
            {r.label}
          </Link>
        ))}
      </aside>
    </>
  );
}
