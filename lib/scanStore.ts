/**
 * In-memory store for in-flight scans between the upload and the review page.
 *
 * Why not Airtable for this?
 *   Airtable is the system of record AFTER Ben hits "Commit". The review
 *   screen is editable scratch space and writing every keystroke to
 *   Airtable would be slow and noisy. Once the user commits, we write the
 *   final, edited rows to Airtable and the scan can be purged from memory.
 *
 * In production on Vercel this gets evicted on cold starts. That's fine —
 * if Ben loses a review session he can re-upload. If we ever need durability
 * (e.g. resumable sessions across devices) we'll swap in Vercel KV here.
 */

import { randomUUID } from "crypto";
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

// Module-level singleton — survives across requests within a single warm
// Lambda/Node process.
//
// We attach to `globalThis` so the Map is shared across module instances.
// In dev, Next.js re-instantiates modules on HMR + can spin up separate
// module graphs for route handlers vs. RSC renders, which would otherwise
// give each side its *own* empty Map and break the upload → review handoff.
const GLOBAL_KEY = Symbol.for("ben-app.scan-store");
type GlobalWithStore = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, ScanSession>;
};
const g = globalThis as GlobalWithStore;
const SCANS: Map<string, ScanSession> = g[GLOBAL_KEY] ?? new Map();
g[GLOBAL_KEY] = SCANS;

const TTL_MS = 1000 * 60 * 60 * 6; // 6h

function gc() {
  const now = Date.now();
  for (const [id, s] of SCANS) {
    if (now - s.createdAt > TTL_MS) SCANS.delete(id);
  }
}

export function createScan(input: Omit<ScanSession, "id" | "createdAt">): ScanSession {
  gc();
  const id = randomUUID();
  const session: ScanSession = { id, createdAt: Date.now(), ...input };
  SCANS.set(id, session);
  return session;
}

export function getScan(id: string): ScanSession | null {
  gc();
  return SCANS.get(id) ?? null;
}

export function updateScan(id: string, patch: Partial<ScanSession>): ScanSession | null {
  const existing = SCANS.get(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  SCANS.set(id, next);
  return next;
}

export function updateRow(id: string, index: number, row: PricedSlab): ScanSession | null {
  const existing = SCANS.get(id);
  if (!existing) return null;
  const rows = existing.rows.slice();
  const i = rows.findIndex((r) => r.slab.index === index);
  if (i === -1) return null;
  rows[i] = row;
  const next = { ...existing, rows };
  SCANS.set(id, next);
  return next;
}

export function deleteScan(id: string): void {
  SCANS.delete(id);
}
