/**
 * Airtable wrapper.
 *
 * Two tables:
 *   - Scans  : one row per photo Ben uploads
 *   - Slabs  : one row per slab extracted from a scan, linked to Scans
 *
 * The schema is provisioned out-of-band (see README) via the Airtable MCP.
 * This file ONLY reads/writes rows.
 */

import Airtable, { type FieldSet, type Records } from "airtable";
import { env } from "@/lib/env";
import type { PricedSlab } from "@/lib/lookup";

let _base: Airtable.Base | null = null;
function base(): Airtable.Base {
  if (!_base) {
    _base = new Airtable({ apiKey: env.AIRTABLE_TOKEN }).base(env.AIRTABLE_BASE_ID);
  }
  return _base;
}

/**
 * Upload an attachment to a record using Airtable's content API (base64, up to 5MB per file).
 * Returns true on success, false on failure (we log + swallow so a missing thumbnail
 * never blocks the commit of the underlying row data).
 *
 * Docs: POST https://content.airtable.com/v0/{baseId}/{recordId}/{attachmentFieldIdOrName}/uploadAttachment
 */
async function uploadAttachmentFromDataUrl(
  recordId: string,
  fieldName: string,
  dataUrl: string,
  filename: string,
): Promise<boolean> {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) {
    console.warn(`[airtable] uploadAttachment: not a base64 data URL (field=${fieldName})`);
    return false;
  }
  const contentType = m[1];
  const file = m[2]; // already base64
  try {
    const res = await fetch(
      `https://content.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${recordId}/${encodeURIComponent(
        fieldName,
      )}/uploadAttachment`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ contentType, file, filename }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[airtable] uploadAttachment failed (${res.status}) field=${fieldName}: ${body.slice(0, 300)}`,
      );
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn(`[airtable] uploadAttachment threw field=${fieldName}: ${e?.message ?? e}`);
    return false;
  }
}

// ---------- Field names — must match the table schema ----------

export const SCAN_FIELDS = {
  Name: "Name",                     // primary
  Photo: "Photo",                   // attachment
  ScannedAt: "Scanned At",          // datetime
  Source: "Source",                 // single line text (dealer name)
  Status: "Status",                 // single select: New / Reviewed / Committed
  SlabCount: "Slab Count",          // number (we set it explicitly, not formula)
  TotalAsk: "Total Their Ask",      // currency
  TotalBid: "Total CDN Bid",        // currency
  Notes: "Notes",                   // long text
} as const;

export const SLAB_FIELDS = {
  Name: "Name",                     // primary, e.g. "1881-S Morgan $1 MS65"
  Scan: "Scan",                     // linked record → Scans
  Thumbnail: "Thumbnail",           // attachment
  GradingService: "Grading Service",
  CertNumber: "Cert #",
  Year: "Year",
  MintMark: "Mint Mark",
  Denomination: "Denomination",
  Variety: "Variety",
  Grade: "Grade",                   // number
  GradeLabel: "Grade Label",
  Designation: "Designation",
  CAC: "CAC",                       // checkbox
  PcgsNumber: "PCGS #",
  Gsid: "GsId",
  CdnBid: "CDN Bid",                // currency
  CdnAsk: "CDN Ask",                // currency
  CpgVal: "CPG Val",
  PcgsVal: "PCGS Val",
  NgcVal: "NGC Val",
  BlueBookVal: "Blue Book Val",
  TheirAsk: "Their Ask",            // currency (handwritten)
  SpreadDollars: "Spread $",        // currency
  SpreadPercent: "Spread %",        // percent
  Decision: "Decision",             // single select: Buy / Pass / Negotiate / Pending
  FinalOffer: "Final Offer",        // currency
  LookedUpAt: "Looked Up At",       // datetime
  Status: "Status",                 // single select: priced / no-pricing / needs-mapping / error
  VisionConfidence: "Vision Confidence", // number (0..1)
  Notes: "Notes",                   // long text
  // --- Sprint 2: PCGS APR auction comps ----------------------------------
  // We store the most-recent sale as two scalar fields so Ben can sort/filter
  // by it directly, plus a long-text summary of up to ~6 sales for reference.
  LastSalePrice: "Last Sale $",     // currency (most recent APR price)
  LastSaleDate: "Last Sale Date",   // date
  AuctionCount: "Auction Comp Count", // number — how many APR sales we found
  AuctionComps: "Auction Comps",    // long text — short human-readable list
} as const;

// ---------- Public API ----------

export interface CommitInput {
  scanSourceFilename: string;
  sourceDealer?: string;
  notes?: string;
  /** Original photo bytes for attaching to Airtable. */
  photoDataUrl: string;
  /** Rows to commit. Each may have a Ben-overridden ask/decision/finalOffer. */
  rows: Array<{
    priced: PricedSlab;
    thumbnailDataUrl: string; // per-slab thumbnail
    decision?: "Buy" | "Pass" | "Negotiate" | "Pending";
    finalOffer?: number | null;
    notesOverride?: string;
  }>;
}

export interface CommitResult {
  scanRecordId: string;
  slabRecordIds: string[];
}

export async function commitScan(input: CommitInput): Promise<CommitResult> {
  const b = base();
  const slabsCount = input.rows.length;
  const totalAsk = input.rows.reduce(
    (s, r) => s + (r.priced.slab.handwritten_ask_price ?? 0),
    0,
  );
  const totalBid = input.rows.reduce(
    (s, r) => s + (r.priced.pricing?.bid ?? 0),
    0,
  );

  // ---------------------------------------------------------------------------
  // ATTACHMENTS NOTE
  // Airtable's "attachments by URL" feature does NOT accept data: URLs — the
  // upload servers must be able to fetch over HTTP. We have raw bytes only, so
  // we create the records *without* attachment fields, then push thumbnails +
  // photo via the dedicated content endpoint (base64, ≤5MB per file).
  // ---------------------------------------------------------------------------

  // 1) Create Scan (text fields only).
  const scanRecord = (await b(env.AIRTABLE_SCANS_TABLE).create([
    {
      fields: {
        [SCAN_FIELDS.Name]: `${new Date().toISOString().slice(0, 16).replace("T", " ")} — ${input.sourceDealer ?? "Scan"}`,
        [SCAN_FIELDS.ScannedAt]: new Date().toISOString(),
        [SCAN_FIELDS.Source]: input.sourceDealer ?? "",
        [SCAN_FIELDS.Status]: "Committed",
        [SCAN_FIELDS.SlabCount]: slabsCount,
        [SCAN_FIELDS.TotalAsk]: totalAsk || null,
        [SCAN_FIELDS.TotalBid]: totalBid || null,
        [SCAN_FIELDS.Notes]: input.notes ?? "",
      },
    },
  ] as any)) as unknown as Array<{ id: string }>;
  const scanId = scanRecord[0].id;

  // 2) Create Slabs (batched, max 10 per Airtable call) — no Thumbnail field yet.
  const records: Array<{ fields: Record<string, any> }> = input.rows.map((r) => {
    const s = r.priced.slab;
    const p = r.priced.pricing;
    return {
      fields: {
        [SLAB_FIELDS.Name]: buildSlabName(r.priced),
        [SLAB_FIELDS.Scan]: [scanId],
        [SLAB_FIELDS.GradingService]: s.grading_service === "UNKNOWN" ? "" : s.grading_service,
        [SLAB_FIELDS.CertNumber]: s.cert_number ?? "",
        [SLAB_FIELDS.Year]: s.year ?? "",
        [SLAB_FIELDS.MintMark]: s.mint_mark ?? "",
        [SLAB_FIELDS.Denomination]: s.denomination ?? "",
        [SLAB_FIELDS.Variety]: s.variety ?? "",
        [SLAB_FIELDS.Grade]: s.grade_numeric,
        [SLAB_FIELDS.GradeLabel]: s.grade_label ?? "",
        [SLAB_FIELDS.Designation]: s.designation ?? "",
        [SLAB_FIELDS.CAC]: s.has_cac_sticker,
        [SLAB_FIELDS.PcgsNumber]: s.pcgs_number ?? "",
        [SLAB_FIELDS.Gsid]: p?.gsid ?? null,
        [SLAB_FIELDS.CdnBid]: p?.bid ?? null,
        [SLAB_FIELDS.CdnAsk]: p?.ask ?? null,
        [SLAB_FIELDS.CpgVal]: p?.ask != null ? String(p.ask) : "",
        [SLAB_FIELDS.PcgsVal]: p?.pcgs != null ? String(p.pcgs) : "",
        [SLAB_FIELDS.NgcVal]: p?.ngc != null ? String(p.ngc) : "",
        [SLAB_FIELDS.BlueBookVal]: p?.blueBook != null ? String(p.blueBook) : "",
        [SLAB_FIELDS.TheirAsk]: s.handwritten_ask_price,
        [SLAB_FIELDS.SpreadDollars]: r.priced.spreadDollars,
        [SLAB_FIELDS.SpreadPercent]: r.priced.spreadPercent,
        [SLAB_FIELDS.Decision]: r.decision ?? "Pending",
        [SLAB_FIELDS.FinalOffer]: r.finalOffer ?? null,
        [SLAB_FIELDS.LookedUpAt]: new Date().toISOString(),
        [SLAB_FIELDS.Status]: r.priced.status,
        [SLAB_FIELDS.VisionConfidence]: s.label_confidence,
        [SLAB_FIELDS.Notes]: r.notesOverride ?? s.notes ?? "",

        // --- Auction comps (PCGS APR) — only populated when we resolved by
        // cert# and CDN returned sales. Otherwise these stay blank.
        [SLAB_FIELDS.LastSalePrice]: r.priced.auctions?.[0]?.price ?? null,
        [SLAB_FIELDS.LastSaleDate]: normalizeAprDate(r.priced.auctions?.[0]?.date) ?? null,
        [SLAB_FIELDS.AuctionCount]: r.priced.auctions?.length ?? null,
        [SLAB_FIELDS.AuctionComps]: formatAuctionComps(r.priced.auctions),
      },
    };
  });

  const slabIds: string[] = [];
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const created = (await b(env.AIRTABLE_SLABS_TABLE).create(
      batch as any,
    )) as unknown as Array<{ id: string }>;
    slabIds.push(...created.map((r) => r.id));
  }

  // 3) Upload attachments. We do this AFTER the records exist so any per-file
  // failure can be logged + skipped without losing the structured data.
  // Photo first (small enough at vision-resize size), then thumbnails in parallel.
  await uploadAttachmentFromDataUrl(
    scanId,
    SCAN_FIELDS.Photo,
    input.photoDataUrl,
    input.scanSourceFilename || "scan.jpg",
  );

  await Promise.all(
    input.rows.map((r, i) => {
      const recId = slabIds[i];
      if (!recId) return Promise.resolve(false);
      return uploadAttachmentFromDataUrl(
        recId,
        SLAB_FIELDS.Thumbnail,
        r.thumbnailDataUrl,
        `slab-${r.priced.slab.index}.jpg`,
      );
    }),
  );

  return { scanRecordId: scanId, slabRecordIds: slabIds };
}

/**
 * Coerce a free-form APR date string (e.g. "Mar 2024", "2024-03-15") into a
 * canonical ISO `YYYY-MM-DD` so Airtable's Date column accepts it. Returns
 * null when we can't safely parse — better an empty cell than a wrong year.
 */
function normalizeAprDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const t = Date.parse(input);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Build a small markdown-ish blob of up to 6 auction comps so Ben can read
 * them inline in the Airtable record without leaving the row. We keep it
 * compact (≤6 lines, ≤2KB) — anything beyond that lives in CDN/PCGS APR.
 */
function formatAuctionComps(
  auctions: PricedSlab["auctions"] | null | undefined,
): string {
  if (!auctions || auctions.length === 0) return "";
  const top = auctions.slice(0, 6);
  return top
    .map((a) => {
      const price = a.price != null ? `$${a.price.toLocaleString("en-US")}` : "—";
      const date = normalizeAprDate(a.date) ?? a.date ?? "—";
      const where = [a.auctioneer, a.saleName].filter(Boolean).join(" — ") || "—";
      const lot = a.lotNo ? `#${a.lotNo}` : "";
      const cac = a.isCac ? " [CAC]" : "";
      return `${date} · ${price} · ${where} ${lot}${cac}`.trim();
    })
    .join("\n");
}

/** Generate a human-friendly slab name like "1881-S Morgan $1 MS65 (PCGS)". */
function buildSlabName(r: PricedSlab): string {
  const s = r.slab;
  const parts: string[] = [];
  if (s.year) parts.push(s.year);
  if (s.mint_mark) parts[parts.length - 1] = `${parts[parts.length - 1] ?? ""}-${s.mint_mark}`;
  if (s.denomination) parts.push(s.denomination);
  if (s.grade_label) parts.push(s.grade_label);
  if (s.designation) parts.push(s.designation);
  if (s.has_cac_sticker) parts.push("CAC");
  if (s.grading_service && s.grading_service !== "UNKNOWN") parts.push(`(${s.grading_service})`);
  const name = parts.filter(Boolean).join(" ").trim();
  return name || `Slab ${s.index}`;
}

// ---------- History (read) ----------

export interface ScanHistoryRow {
  id: string;
  name: string;
  source: string;
  scannedAt: string;
  slabCount: number | null;
  totalAsk: number | null;
  totalBid: number | null;
  status: string;
}

export async function listScans(limit = 50): Promise<ScanHistoryRow[]> {
  const b = base();
  const records: Records<FieldSet> = await b(env.AIRTABLE_SCANS_TABLE)
    .select({
      maxRecords: limit,
      sort: [{ field: SCAN_FIELDS.ScannedAt, direction: "desc" }],
    })
    .all();

  return records.map((r) => ({
    id: r.id,
    name: String(r.get(SCAN_FIELDS.Name) ?? ""),
    source: String(r.get(SCAN_FIELDS.Source) ?? ""),
    scannedAt: String(r.get(SCAN_FIELDS.ScannedAt) ?? ""),
    slabCount: (r.get(SCAN_FIELDS.SlabCount) as number) ?? null,
    totalAsk: (r.get(SCAN_FIELDS.TotalAsk) as number) ?? null,
    totalBid: (r.get(SCAN_FIELDS.TotalBid) as number) ?? null,
    status: String(r.get(SCAN_FIELDS.Status) ?? ""),
  }));
}
