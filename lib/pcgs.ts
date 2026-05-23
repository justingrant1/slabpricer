/**
 * PCGS Public API client.
 *
 * Docs: pcgs-api-instructions.md
 *
 * Auth: Authorization: bearer <token>
 *
 * What we use it for:
 *   - In-hand slab lookups (scan barcode OR type cert #) — pulls back
 *     PCGSNo + grade + designation so we can turn around and ask CDN
 *     for the bid/ask via our existing pricing path.
 *
 * Endpoints covered here:
 *   - GET /coindetail/GetCoinFactsByCertNo/{certNo}       (PCGS certs)
 *   - GET /coindetail/GetCoinFactsByBarcode               (PCGS or NGC barcodes)
 *
 * Both return the same shape (see PcgsCoinFacts below).
 */

import { env } from "@/lib/env";

// ---------- Response shapes (subset of what PCGS returns) ----------

export interface PcgsCoinImage {
  Thumbnail?: string | null;
  Fullsize?: string | null;
}

export interface PcgsAuction {
  Service?: string;
  Date?: string;
  Auctioneer?: string;
  LotNo?: number;
  LotNumV2?: string;
  SaleName?: string;
  CertNo?: string;
  Price?: number;
  IsCAC?: boolean;
  AuctionLotUrl?: string;
}

/** Full CoinFacts payload (we only type fields we actually read). */
export interface PcgsCoinFacts {
  PCGSNo?: string | null;
  CertNo?: string | null;
  Name?: string | null;
  Year?: number | string | null;
  Denomination?: string | null;
  Mintage?: string | null;
  MintMark?: string | null;
  MintLocation?: string | null;
  Country?: string | null;
  Grade?: string | null;
  Designation?: string | null;
  PriceGuideValue?: number | null;
  Population?: number | null;
  PopHigher?: number | null;
  CoinFactsLink?: string | null;
  Designer?: string | null;
  Images?: PcgsCoinImage[] | null;
  CoinFactsNotes?: string | null;
  MajorVariety?: string | null;
  MinorVariety?: string | null;
  DieVariety?: string | null;
  AuctionList?: PcgsAuction[] | null;
  SeriesName?: string | null;
  Category?: string | null;
  HasObverseImage?: boolean;
  HasReverseImage?: boolean;
  HasTrueViewImage?: boolean;
  ImageReady?: boolean;
  IsNFCSecure?: boolean;
  IsValidRequest: boolean;
  ServerMessage?: string | null;
}

export type GradingServiceQuery = "PCGS" | "NGC";

// ---------- Errors ----------

export class PcgsApiError extends Error {
  constructor(
    public status: number,
    public serverMessage: string | null,
    message: string,
  ) {
    super(message);
    this.name = "PcgsApiError";
  }
}

/** Thrown when PCGS responded 200 but with `IsValidRequest: false` or "No data found". */
export class PcgsNotFoundError extends Error {
  constructor(public serverMessage: string) {
    super(serverMessage || "PCGS: no data found");
    this.name = "PcgsNotFoundError";
  }
}

// ---------- Client ----------

function authHeader(): Record<string, string> {
  return { Authorization: `bearer ${env.PCGS_API_TOKEN}` };
}

async function pcgsGet<T>(path: string, query: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = new URL(`${env.PCGS_API_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }

  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: { ...authHeader(), Accept: "application/json" },
    // PCGS is sensitive to caching; never cache.
    cache: "no-store",
  });

  // 204 — empty request data (per docs)
  if (resp.status === 204) {
    throw new PcgsNotFoundError("Empty request (204)");
  }

  const text = await resp.text();
  if (!resp.ok) {
    throw new PcgsApiError(resp.status, null, `PCGS ${resp.status}: ${text.slice(0, 200)}`);
  }

  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new PcgsApiError(resp.status, null, `PCGS returned non-JSON: ${text.slice(0, 200)}`);
  }

  // PCGS uses 200 + IsValidRequest:false for validation failures
  // (e.g. malformed cert number) and 200 + ServerMessage:"No data found"
  // for "you asked for a coin we don't know about".
  if (json?.IsValidRequest === false) {
    throw new PcgsApiError(200, json.ServerMessage ?? null, `PCGS invalid request: ${json.ServerMessage ?? "unknown"}`);
  }
  if (typeof json?.ServerMessage === "string" && /no data found/i.test(json.ServerMessage)) {
    throw new PcgsNotFoundError(json.ServerMessage);
  }

  return json as T;
}

export const pcgs = {
  /** Coin lookup by PCGS cert number (path param). */
  async coinFactsByCertNo(certNo: string, retrieveAllData = true): Promise<PcgsCoinFacts> {
    const clean = String(certNo).trim();
    if (!/^\d+$/.test(clean)) {
      throw new PcgsApiError(400, null, `Cert number must be all digits, got "${certNo}"`);
    }
    return pcgsGet<PcgsCoinFacts>(`/coindetail/GetCoinFactsByCertNo/${encodeURIComponent(clean)}`, {
      retrieveAllData,
    });
  },

  /**
   * Coin lookup by holder barcode (works for both PCGS and NGC slabs).
   * `barcode` is the raw decoded text from a 1D/2D scanner.
   */
  async coinFactsByBarcode(barcode: string, gradingService: GradingServiceQuery): Promise<PcgsCoinFacts> {
    const clean = String(barcode).trim();
    if (!clean) throw new PcgsApiError(400, null, "Empty barcode");
    return pcgsGet<PcgsCoinFacts>("/coindetail/GetCoinFactsByBarcode", {
      barcode: clean,
      gradingService,
    });
  },
};

/** True iff PCGS_API_TOKEN is set. */
export function hasPcgsCreds(): boolean {
  return Boolean(process.env.PCGS_API_TOKEN);
}

// ---------- Helpers used by the API route ----------

/**
 * Parse a PCGS grade string like "MS66", "MS66+", "PR67DCAM", "AU58", "Genuine",
 * "AU Details" into a numeric Sheldon grade + plus flag.
 * Returns { numeric: null, plus: false } for details / genuine / unparseable.
 */
export function parsePcgsGrade(grade: string | null | undefined): { numeric: number | null; plus: boolean } {
  if (!grade) return { numeric: null, plus: false };
  const g = grade.toString();
  // Extract the FIRST 1–2 digit number (1..70).
  const m = g.match(/(\d{1,2})/);
  const numeric = m ? Math.min(70, Math.max(1, parseInt(m[1], 10))) : null;
  const plus = /\+/.test(g);
  // "Details" / "Genuine" / "Ungradable" → no numeric grade
  if (/details|genuine|no\s*grade|ungrad/i.test(g) && numeric == null) {
    return { numeric: null, plus: false };
  }
  return { numeric, plus };
}

/**
 * Best-effort: from raw scanned text, guess whether it's a PCGS or NGC barcode.
 *   - PCGS holder barcodes typically encode the cert # (8-digit numeric, sometimes with leading zeros).
 *   - NGC barcodes are alphanumeric and longer.
 * If we can't tell, returns "PCGS" as default (caller's UI lets Ben override).
 */
export function guessGradingService(rawBarcode: string): GradingServiceQuery {
  const s = rawBarcode.trim();
  // Numeric-only and 7–10 chars → PCGS cert
  if (/^\d{7,10}$/.test(s)) return "PCGS";
  // Anything containing letters → likely NGC
  if (/[A-Za-z]/.test(s)) return "NGC";
  return "PCGS";
}
