"use client";

import { useState } from "react";

export default function LoginForm({ next, error }: { next: string; error?: string }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(error ?? "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw, next }),
    });
    if (res.ok) {
      window.location.href = next || "/";
      return;
    }
    setBusy(false);
    setErr("Incorrect password.");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        type="password"
        autoFocus
        autoComplete="current-password"
        className="input"
        placeholder="Password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
      />
      {err && <p className="text-sm text-bad">{err}</p>}
      <button className="btn-primary w-full" disabled={busy || !pw}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
