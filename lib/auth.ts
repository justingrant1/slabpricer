/**
 * Tiny password-based auth: a single shared password for Ben.
 *
 *   - POST /login → if password matches APP_PASSWORD, set a signed
 *     HttpOnly cookie containing an HMAC of "ok|<expiry>".
 *   - Middleware checks the cookie on every page except /login + static assets.
 *
 * This is intentionally simple. If/when we need multi-user, swap in NextAuth.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

const COOKIE_NAME = "ben_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function buildSessionCookieValue(): string {
  const expiry = Date.now() + COOKIE_MAX_AGE * 1000;
  const payload = `ok|${expiry}`;
  const sig = sign(payload, env.SESSION_SECRET);
  return `${payload}|${sig}`;
}

export function verifySessionCookieValue(value: string | undefined | null): boolean {
  if (!value) return false;
  const parts = value.split("|");
  if (parts.length !== 3) return false;
  const [tag, expiryStr, sig] = parts;
  if (tag !== "ok") return false;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const expected = sign(`${tag}|${expiryStr}`, env.SESSION_SECRET);
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function checkPassword(input: string): boolean {
  if (!input || !env.APP_PASSWORD) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(env.APP_PASSWORD);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const SESSION_COOKIE = COOKIE_NAME;
export const SESSION_MAX_AGE = COOKIE_MAX_AGE;
