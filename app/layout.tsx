import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ben's Slab Pricer",
  description: "Scan dealer photos, look up CDN pricing, commit to Airtable.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">{children}</main>
        <footer className="text-xs text-muted text-center py-4 border-t border-border">
          Ben's Slab Pricer · CDN CPG API v2 · Powered by GPT‑4o vision
        </footer>
      </body>
    </html>
  );
}

function Header() {
  return (
    <header className="border-b border-border bg-panel/60 backdrop-blur sticky top-0 z-20">
      <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-6">
        <Link href="/" className="font-semibold text-text">
          🪙 Slab Pricer
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted">
          <Link href="/" className="hover:text-text">New Scan</Link>
          <Link href="/history" className="hover:text-text">History</Link>
        </nav>
      </div>
    </header>
  );
}
