/**
 * Edge middleware — gate every page behind the session cookie.
 *
 * Uses Web Crypto (SubtleCrypto) because Node's `crypto` module is not
 * available in the edge runtime. Logic mirrors verifySessionCookieValue
 * in lib/auth.ts.
 */

import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "ben_session";

// Paths that don't require auth
const PUBLIC_PATHS = [
  "/login",
  "/api/login",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes + static assets
  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt"
  ) {
    return NextResponse.next();
  }

  const secret = process.env.SESSION_SECRET ?? "";
  if (!secret) {
    // Fail loudly so this doesn't silently look like "wrong password".
    console.error(
      "[middleware] SESSION_SECRET is empty — every request will be redirected to /login. " +
        "Set SESSION_SECRET in .env.local and restart `pnpm dev`.",
    );
  }
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = await verifySession(cookie, secret);
  if (ok) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname + (req.nextUrl.search ?? ""));
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

// ---------- Web Crypto HMAC mirror of lib/auth.ts ----------

async function verifySession(value: string | undefined, secret: string): Promise<boolean> {
  if (!value || !secret) return false;
  const parts = value.split("|");
  if (parts.length !== 3) return false;
  const [tag, expiryStr, sig] = parts;
  if (tag !== "ok") return false;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const expected = await hmacHex(`${tag}|${expiryStr}`, secret);
  return constantTimeEqual(expected, sig);
}

async function hmacHex(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
