import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ustawia katalog projektu jako root dla Turbopack — działa lokalnie i na Vercel
  // (import.meta.dirname zamiast zakodowanej ścieżki, która nie istnieje na serwerze build).
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
