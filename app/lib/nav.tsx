"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/lib/auth";

// Pełna nawigacja — 14 stron. Dashboard 🏠 na górze.
const ROUTES = [
  { href: "/", emoji: "🏠", label: "Dashboard" },
  { href: "/chat", emoji: "💬", label: "Chat" },
  { href: "/email-triage", emoji: "📧", label: "E-mail Triage" },
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
  { href: "/report", emoji: "📊", label: "Raporty" },
  { href: "/generate", emoji: "🎨", label: "Grafiki" },
  { href: "/vision", emoji: "👁️", label: "Vision" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  async function logout() {
    close();
    await supabase.auth.signOut();
    // onAuthStateChange w AuthProvider wychwyci wylogowanie, ale kierujemy od
    // razu na /login, żeby nie mignęła chroniona strona.
    router.replace("/login");
  }

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

        {/* Konto zalogowanego użytkownika + wylogowanie — przyklejone na dole. */}
        <div style={{ flex: 1 }} />
        <div
          style={{
            borderTop: "1px solid #1e1e2a",
            marginTop: 8,
            paddingTop: 10,
          }}
        >
          {user?.email && (
            <div
              style={{
                fontSize: 12,
                color: "#888",
                padding: "0 12px 8px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={user.email}
            >
              👤 {user.email}
            </div>
          )}
          <button
            onClick={logout}
            className="nav-link"
            style={{
              width: "100%",
              background: "transparent",
              border: "1px solid #3a2a2a",
              color: "#f0a0a0",
              cursor: "pointer",
              font: "inherit",
              fontSize: 14,
            }}
          >
            <span>🚪</span>
            Wyloguj
          </button>
        </div>
      </aside>
    </>
  );
}
