/**
 * POST /api/lookup
 *
 * "Slab in hand" path — Ben has a physical slab, either scanned the
 * barcode in the browser or typed in the cert #. This:
 *
 *   1. Calls PCGS Public API → CoinFacts (PCGS# + grade + label info)
 *   2. Synthesizes an ExtractedSlab from that payload (so the rest of
 *      the pipeline is identical to the dealer-photo flow).
 *   3. Calls priceSlab → CDN bid/ask via PCGS#.
 *   4. Optionally downloads the PCGS coin image as our "source" so the
 *      review page has a thumbnail to show and Airtable gets an attachment.
 *   5. Stores a 1-row scan session and returns its id.
 *
 * Request body (application/json):
 *   { barcode: string, service?: "PCGS" | "NGC" }   OR
 *   { certNo: string,  service?: "PCGS" | "NGC" }   (NGC certNo uses barcode endpoint)
 */

import { NextResponse } from "next/server";
import { pcgs, parsePcgsGrade, guessGradingService, PcgsNotFoundError, PcgsApiError, type PcgsCoinFacts, type GradingServiceQuery } from "@/lib/pcgs";
import { priceSlab } from "@/lib/lookup";
import { createScan } from "@/lib/scanStore";
import type { ExtractedSlab, VisionResult, GradingService } from "@/lib/vision";

export const runtime = "nodejs";
export const maxDuration = 30;

interface LookupBody {
  barcode?: string;
  certNo?: string;
  service?: GradingServiceQuery;
  /** Free-form source/note ("Bob's table", "DM from Joe", etc.) */
  source?: string;
}

export async function POST(req: Request) {
  let body: LookupBody;
  try {
    body = (await req.json()) as LookupBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const barcode = body.barcode?.trim() || "";
  const certNo = body.certNo?.trim() || "";
  if (!barcode && !certNo) {
    return NextResponse.json({ error: "Provide either `barcode` or `certNo`" }, { status: 400 });
  }

  // 1) PCGS lookup
  let facts: PcgsCoinFacts;
  let resolvedService: GradingServiceQuery;
  try {
    if (barcode) {
      resolvedService = body.service ?? guessGradingService(barcode);
      facts = await pcgs.coinFactsByBarcode(barcode, resolvedService);
    } else {
      // typed cert #
      resolvedService = body.service ?? "PCGS";
      if (resolvedService === "PCGS") {
        facts = await pcgs.coinFactsByCertNo(certNo);
      } else {
        // NGC cert lookup not in our docs as a direct endpoint, but the
        // barcode endpoint accepts the cert digits with gradingService=NGC.
        facts = await pcgs.coinFactsByBarcode(certNo, "NGC");
      }
    }
  } catch (e: any) {
    if (e instanceof PcgsNotFoundError) {
      return NextResponse.json({ error: `PCGS: no match (${e.serverMessage})` }, { status: 404 });
    }
    if (e instanceof PcgsApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
    }
    return NextResponse.json({ error: `PCGS lookup failed: ${e?.message ?? e}` }, { status: 502 });
  }

  // 2) Synthesize an ExtractedSlab so the existing pipeline can price it.
  const { numeric: gradeNumeric, plus: gradePlus } = parsePcgsGrade(facts.Grade);
  const gradeLabel = facts.Grade ?? null;
  const slab: ExtractedSlab = {
    index: 1,
    grading_service: (resolvedService as GradingService) ?? "UNKNOWN",
    cert_number: facts.CertNo ?? (certNo || (/^\d+$/.test(barcode) ? barcode : null)),
    year: facts.Year != null ? String(facts.Year) : null,
    mint_mark: facts.MintMark ?? null,
    denomination: facts.Name ?? facts.Denomination ?? null,
    variety: facts.MajorVariety || facts.MinorVariety || facts.DieVariety || null,
    grade_label: gradeLabel,
    grade_numeric: gradeNumeric,
    designation: facts.Designation ?? null,
    pcgs_number: facts.PCGSNo ?? null,
    has_cac_sticker: false, // not knowable from PCGS API — Ben can flip in UI
    handwritten_ask_price: null, // doesn't apply to in-hand flow
    crop_box: [0, 0, 1, 1],
    label_confidence: 1, // PCGS is the source of truth
    notes: gradePlus ? "Plus grade (+)" : null,
  };

  // 3) Price via CDN (uses pcgs_number + numeric grade)
  const priced = await priceSlab(slab);

  // 4) Try to pull PCGS coin image as our "source" thumbnail. Falls back
  //    to a transparent placeholder if PCGS has no image.
  const sourceDataUrl = await fetchPcgsImageAsDataUrl(facts);

  // 5) Build a VisionResult-shaped wrapper so /scan/[id] just works.
  const vision: VisionResult = {
    slabs: [slab],
    global_notes: null,
    total_slabs_detected: 1,
  };

  const session = createScan({
    sourceDataUrl,
    sourceMimeType: "image/jpeg",
    sourceFilename: `${resolvedService.toLowerCase()}-${slab.cert_number ?? "slab"}.jpg`,
    source: body.source ?? `In-hand · ${resolvedService}${slab.cert_number ? ` #${slab.cert_number}` : ""}`,
    vision,
    rows: [priced],
  });

  return NextResponse.json({
    id: session.id,
    slabCount: 1,
    status: priced.status,
  });
}

// ----------------- helpers -----------------

/**
 * Pull the best PCGS-hosted coin image and return it as a JPEG data URL.
 * Falls back to a 1x1 transparent PNG if PCGS has no image / fetch fails —
 * the review page still renders, it just has no source image.
 */
async function fetchPcgsImageAsDataUrl(facts: PcgsCoinFacts): Promise<string> {
  const url = pickPcgsImageUrl(facts);
  if (!url) return TRANSPARENT_PNG_DATA_URL;
  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) return TRANSPARENT_PNG_DATA_URL;
    const ct = resp.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength === 0) return TRANSPARENT_PNG_DATA_URL;
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return TRANSPARENT_PNG_DATA_URL;
  }
}

function pickPcgsImageUrl(facts: PcgsCoinFacts): string | null {
  const images = facts.Images ?? [];
  for (const img of images) {
    if (img?.Fullsize) return img.Fullsize;
  }
  for (const img of images) {
    if (img?.Thumbnail) return img.Thumbnail;
  }
  return null;
}

const TRANSPARENT_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
