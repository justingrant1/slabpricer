/**
 * Durable scan-session store.
 *
 * Backing store:
 *   - Vercel KV (Upstash Redis) when `KV_REST_API_URL` + `KV_REST_API_TOKEN`
 *     are present (Vercel auto-injects these once you link a KV store to the
 *     project).
 *   - In-memory Map fallback otherwise (local dev without KV configured).
 *
 * Why it has to be durable in prod:
 *   On Vercel each request can hit a *different* serverless lambda instance,
 *   each with its own JS heap. An in-memory Map "works" only as long as
 *   subsequent requests happen to land on the same warm instance — which is
 *   why the review page would 404 sometimes after a successful upload.
 *
 * Why not Airtable for this?
 *   Airtable is the system of record AFTER Ben hits "Commit". The review
 *   screen is editable scratch space; writing every keystroke / re-price to
 *   Airtable would be slow and noisy. Once the user commits, we write the
 *   final, edited rows to Airtable and the scan can be purged.
 *
 * Note: every function here is now async. All callers must `await`.
 */

import { randomUUID } from "crypto";
import { kv } from "@vercel/kv";
import type { PricedSlab } from "@/lib/lookup";
import type { VisionResult } from "@/lib/vision";

export interface ScanSession {
  id: string;
  createdAt: number;
  /** Original photo bytes, encoded as a data URL for easy re-rendering. */
  sourceDataUrl: string;
  sourceMimeType: string;
  sourceFilename: string;
  /** Source of the slabs — dealer name, message thread, etc. Free text. */
  source?: string;
  vision: VisionResult;
  rows: PricedSlab[];
}

const TTL_SECONDS = 60 * 60 * 6; // 6h — long enough for Ben to come back to a review

const HAS_KV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// ------------------------------------------------------------------
// In-memory fallback (local dev, or production without KV configured)
// ------------------------------------------------------------------
const GLOBAL_KEY = Symbol.for("ben-app.scan-store");
type GlobalWithStore = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, ScanSession>;
};
const g = globalThis as GlobalWithStore;
const MEM: Map<string, ScanSession> = g[GLOBAL_KEY] ?? new Map();
g[GLOBAL_KEY] = MEM;

function memGc() {
  const now = Date.now();
  for (const [id, s] of MEM) {
    if (now - s.createdAt > TTL_SECONDS * 1000) MEM.delete(id);
  }
}

const kvKey = (id: string) => `scan:${id}`;

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

export async function createScan(
  input: Omit<ScanSession, "id" | "createdAt">,
): Promise<ScanSession> {
  const id = randomUUID();
  const session: ScanSession = { id, createdAt: Date.now(), ...input };
  if (HAS_KV) {
    await kv.set(kvKey(id), session, { ex: TTL_SECONDS });
  } else {
    memGc();
    MEM.set(id, session);
  }
  return session;
}

export async function getScan(id: string): Promise<ScanSession | null> {
  if (HAS_KV) {
    const s = (await kv.get<ScanSession>(kvKey(id))) ?? null;
    return s;
  }
  memGc();
  return MEM.get(id) ?? null;
}

export async function updateScan(
  id: string,
  patch: Partial<ScanSession>,
): Promise<ScanSession | null> {
  const existing = await getScan(id);
  if (!existing) return null;
  const next: ScanSession = { ...existing, ...patch };
  if (HAS_KV) {
    await kv.set(kvKey(id), next, { ex: TTL_SECONDS });
  } else {
    MEM.set(id, next);
  }
  return next;
}

export async function updateRow(
  id: string,
  index: number,
  row: PricedSlab,
): Promise<ScanSession | null> {
  const existing = await getScan(id);
  if (!existing) return null;
  const rows = existing.rows.slice();
  const i = rows.findIndex((r) => r.slab.index === index);
  if (i === -1) return null;
  rows[i] = row;
  const next: ScanSession = { ...existing, rows };
  if (HAS_KV) {
    await kv.set(kvKey(id), next, { ex: TTL_SECONDS });
  } else {
    MEM.set(id, next);
  }
  return next;
}

export async function deleteScan(id: string): Promise<void> {
  if (HAS_KV) {
    await kv.del(kvKey(id));
  } else {
    MEM.delete(id);
  }
}
