/**
 * Orchestration layer: given an ExtractedSlab from the vision model,
 * resolve it against CDN and return a fully-priced row for the review UI.
 *
 * Strategy (in order — first one that yields a Gsid wins):
 *   1. If `pcgs_number` is set            →  /GetPricingRequest by PcgsNumber
 *   2. Else if denomination maps to a CDN
 *      node and year+mint match a catalog
 *      entry                                →  catalog-walk → Gsid → /GetPricingRequest
 *   3. Else                                 →  return UNRESOLVED, surface to UI
 *
 * The UI then lets Ben:
 *   - confirm/edit any vision field and re-run priceSlab
 *   - manually set a Gsid (e.g. by searching greysheet.com)
 */

import { cdn, summarisePricing, type SlabPricingSummary } from "@/lib/cdn";
import {
  findGsidByCatalogWalk,
  resolveDenominationNodeId,
} from "@/lib/cdnCatalog";
import type { ExtractedSlab } from "@/lib/vision";
import { hasCdnCreds } from "@/lib/env";
import {
  pcgs,
  PcgsApiError,
  PcgsNotFoundError,
  type GradingServiceQuery,
  type PcgsAuction,
  type PcgsCoinFacts,
} from "@/lib/pcgs";

export type LookupStatus =
  | "priced"          // got real bid/ask
  | "no-pricing"      // CDN found the coin but had no prices for that grade
  | "needs-mapping"   // we don't have a pcgs# / gsid; Ben must map manually
  | "no-credentials"  // CDN_API_KEY/TOKEN aren't set yet (dev mode)
  | "error";

/** A single auction comp (sale of this exact cert OR a peer coin at same grade). */
export interface AuctionComp {
  date: string | null;
  auctioneer: string | null;
  saleName: string | null;
  lotNo: string | null;
  certNo: string | null;
  price: number | null;
  isCac: boolean;
  service: string | null;
  url: string | null;
}

export interface PricedSlab {
  /** Original vision extraction (possibly edited by Ben). */
  slab: ExtractedSlab;
  /** Pricing summary if we found one. */
  pricing: SlabPricingSummary | null;
  status: LookupStatus;
  errorMessage?: string;
  /**
   * Spread in $ (their ask - bid). Negative means dealer is below CDN bid (good).
   * Null if we don't have both numbers.
   */
  spreadDollars: number | null;
  /** Spread as fraction of bid. */
  spreadPercent: number | null;
  /**
   * How we resolved the slab to a Gsid. Helps debug & shows in the UI.
   */
  resolvedVia?: "pcgs-cert" | "pcgs-number" | "catalog-walk" | "manual-gsid";
  /**
   * If a PCGS CoinFacts lookup succeeded along the way, the canonical data
   * (PCGS#, grade, designation, name, etc.). Used to populate the UI when
   * vision was wrong about something the cert# disambiguated.
   */
  pcgsFacts?: PcgsCoinFacts | null;
  /**
   * Recent auction comps from PCGS APR — populated when we resolve via cert#.
   * Empty array means "looked but found none"; null/undefined means "didn't look".
   */
  auctions?: AuctionComp[] | null;
}

/** Single-slab lookup. */
export async function priceSlab(slab: ExtractedSlab): Promise<PricedSlab> {
  if (!hasCdnCreds()) {
    return {
      slab,
      pricing: null,
      status: "no-credentials",
      spreadDollars: null,
      spreadPercent: null,
    };
  }

  // Need at least a numeric grade to ask for pricing.
  const grade = slab.grade_numeric;
  if (!grade) {
    return {
      slab,
      pricing: null,
      status: "needs-mapping",
      errorMessage: "No numeric grade extracted (details / genuine?)",
      spreadDollars: null,
      spreadPercent: null,
    };
  }

  // Strategy 0: cert number + grading service → PCGS CoinFacts → PCGS# + APR.
  // This is the most reliable path: a cert # uniquely identifies the coin, so
  // PCGS will return the authoritative PCGS#, grade, designation, and recent
  // auction comps in one round-trip. We then ask CDN for pricing by that PCGS#.
  //
  // Only PCGS certs go through CertNo; NGC certs need the barcode endpoint
  // which we don't have from a dealer photo. ANACS / ICG fall through to the
  // PCGS-number path (if vision picked one up) or the catalog walk.
  const certFacts = await tryPcgsByCert(slab);
  if (certFacts) {
    const pcgsNo = certFacts.PCGSNo?.trim() || null;
    const auctions = normalizeAuctions(certFacts.AuctionList);
    if (pcgsNo) {
      try {
        const pricing = await pricingByPcgsNumber(pcgsNo, grade, slab.has_cac_sticker);
        if (pricing) {
          const out = finalize(slab, pricing, "pcgs-cert");
          out.pcgsFacts = certFacts;
          out.auctions = auctions;
          return out;
        }
      } catch (e: any) {
        console.warn(`[lookup] cert#${slab.cert_number} → CDN by PCGS#${pcgsNo} failed:`, e?.message);
      }
    }
    // PCGS knew the coin but CDN didn't price it — still surface the facts
    // (PCGS#, name, auctions) so Ben sees something useful while he maps it.
    return {
      slab,
      pricing: null,
      status: "no-pricing",
      errorMessage: pcgsNo
        ? `PCGS recognised cert ${slab.cert_number} (#${pcgsNo}) but CDN returned no pricing at grade ${grade}.`
        : `PCGS recognised cert ${slab.cert_number} but didn't return a PCGS#; map manually.`,
      spreadDollars: null,
      spreadPercent: null,
      resolvedVia: "pcgs-cert",
      pcgsFacts: certFacts,
      auctions,
    };
  }

  // Strategy 1: PCGS coin number from the label.
  if (slab.pcgs_number) {
    try {
      const pricing = await pricingByPcgsNumber(slab.pcgs_number, grade, slab.has_cac_sticker);
      if (pricing) return finalize(slab, pricing, "pcgs-number");
      // CDN had no item for that PCGS#; fall through to catalog walk.
    } catch (e: any) {
      // Keep going — catalog walk might succeed.
      console.warn(`[lookup] PCGS# lookup failed for ${slab.pcgs_number}:`, e?.message);
    }
  }

  // Strategy 2: catalog walk by denomination + year + mint.
  const nodeId = resolveDenominationNodeId(slab.denomination, slab.year);
  if (nodeId) {
    try {
      const match = await findGsidByCatalogWalk({
        nodeId,
        year: slab.year,
        mintMark: slab.mint_mark,
        variety: slab.variety,
        designation: slab.designation,
      });
      if (match) {
        const pricing = await pricingByGsid(match.gsid, grade, slab.has_cac_sticker);
        if (pricing) return finalize(slab, pricing, "catalog-walk");
      }
    } catch (e: any) {
      console.warn(`[lookup] catalog walk failed (node ${nodeId}):`, e?.message);
    }
  }

  // No mapping found.
  return {
    slab,
    pricing: null,
    status: "needs-mapping",
    errorMessage: slab.pcgs_number
      ? `CDN had no item for PCGS#${slab.pcgs_number} and no catalog match`
      : "Couldn't auto-map this slab — paste a Greysheet ID below.",
    spreadDollars: null,
    spreadPercent: null,
  };
}

/** Look up pricing once Ben has manually supplied a Gsid. */
export async function priceSlabByGsid(slab: ExtractedSlab, gsid: number): Promise<PricedSlab> {
  if (!hasCdnCreds()) {
    return {
      slab,
      pricing: null,
      status: "no-credentials",
      spreadDollars: null,
      spreadPercent: null,
    };
  }
  const grade = slab.grade_numeric;
  if (!grade) {
    return {
      slab,
      pricing: null,
      status: "needs-mapping",
      errorMessage: "No numeric grade",
      spreadDollars: null,
      spreadPercent: null,
    };
  }
  try {
    const pricing = await pricingByGsid(gsid, grade, slab.has_cac_sticker);
    if (!pricing) {
      return {
        slab,
        pricing: null,
        status: "needs-mapping",
        errorMessage: `CDN returned no item for Gsid ${gsid}`,
        spreadDollars: null,
        spreadPercent: null,
      };
    }
    return finalize(slab, pricing, "manual-gsid");
  } catch (e: any) {
    return {
      slab,
      pricing: null,
      status: "error",
      errorMessage: e?.message ?? String(e),
      spreadDollars: null,
      spreadPercent: null,
    };
  }
}

/** Price every slab from a vision result, in parallel. */
export async function priceAll(slabs: ExtractedSlab[]): Promise<PricedSlab[]> {
  return Promise.all(slabs.map(priceSlab));
}

// ---------- helpers ----------

/**
 * Hit /GetPricingRequest by PcgsNumber. If no PricingData row exists for the
 * exact grade, retry once with a ±2 grade window so the nearest published row
 * is included in PricingData — `summarisePricing` then picks the closest.
 */
async function pricingByPcgsNumber(
  pcgsNumber: string,
  grade: number,
  cac: boolean,
): Promise<SlabPricingSummary | null> {
  // First pass: exact grade.
  let resp = await cdn.getPricing({ pcgsNumber, grade, advanced: true });
  let item = resp.Data?.[0];
  if (!item) return null;

  let summary = summarisePricing(item, grade, cac);
  if (summary && (summary.bid != null || summary.ask != null)) return summary;

  // Second pass: widen the grade window and let summarisePricing pick the nearest.
  resp = await cdn.getPricing({
    pcgsNumber,
    minGrade: Math.max(1, grade - 2),
    maxGrade: Math.min(70, grade + 2),
    advanced: true,
  });
  item = resp.Data?.[0];
  if (!item) return summary;
  return summarisePricing(item, grade, cac) ?? summary;
}

/** Same as above but keyed by Gsid (manual override or catalog walk). */
async function pricingByGsid(
  gsid: number,
  grade: number,
  cac: boolean,
): Promise<SlabPricingSummary | null> {
  let resp = await cdn.getPricing({ gsid, grade, advanced: true });
  let item = resp.Data?.[0];
  if (!item) return null;

  let summary = summarisePricing(item, grade, cac);
  if (summary && (summary.bid != null || summary.ask != null)) return summary;

  resp = await cdn.getPricing({
    gsid,
    minGrade: Math.max(1, grade - 2),
    maxGrade: Math.min(70, grade + 2),
    advanced: true,
  });
  item = resp.Data?.[0];
  if (!item) return summary;
  return summarisePricing(item, grade, cac) ?? summary;
}

function finalize(
  slab: ExtractedSlab,
  pricing: SlabPricingSummary | null,
  resolvedVia: PricedSlab["resolvedVia"],
): PricedSlab {
  const status: LookupStatus = !pricing
    ? "no-pricing"
    : pricing.bid == null && pricing.ask == null
      ? "no-pricing"
      : "priced";

  const ask = slab.handwritten_ask_price;
  const bid = pricing?.bid ?? null;
  const spreadDollars = ask != null && bid != null ? ask - bid : null;
  const spreadPercent = ask != null && bid && bid > 0 ? (ask - bid) / bid : null;

  return { slab, pricing, status, spreadDollars, spreadPercent, resolvedVia };
}

/**
 * Attempt to resolve a slab via PCGS CoinFacts using its cert number.
 *
 * Returns `null` (don't throw) when:
 *   - PCGS_API_TOKEN is not set
 *   - the slab has no cert# or grading_service !== "PCGS"
 *   - PCGS doesn't recognise the cert (PcgsNotFoundError)
 *   - any other PCGS error (logged and swallowed — we still want the
 *     downstream PCGS#/catalog-walk strategies to run)
 */
async function tryPcgsByCert(slab: ExtractedSlab): Promise<PcgsCoinFacts | null> {
  if (!process.env.PCGS_API_TOKEN) return null;
  const certNo = (slab.cert_number ?? "").trim();
  if (!certNo) return null;
  // PCGS CertNo endpoint is PCGS-only. NGC needs the barcode endpoint which we
  // don't have from a dealer photo. (NGC certs from a label scan can still be
  // tried — they're numeric — but PCGS rejects them, so guard by service.)
  if (slab.grading_service !== "PCGS") return null;
  if (!/^\d{6,10}$/.test(certNo)) return null;

  try {
    return await pcgs.coinFactsByCertNo(certNo, /* retrieveAllData */ true);
  } catch (e) {
    if (e instanceof PcgsNotFoundError) return null;
    if (e instanceof PcgsApiError) {
      console.warn(`[lookup] PCGS cert ${certNo} error:`, e.message);
      return null;
    }
    console.warn(`[lookup] PCGS cert ${certNo} unexpected:`, (e as any)?.message ?? e);
    return null;
  }
}

/** Convert the loosely-typed PCGS AuctionList into our compact AuctionComp[]. */
function normalizeAuctions(list: PcgsAuction[] | null | undefined): AuctionComp[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((a) => ({
      date: a.Date ?? null,
      auctioneer: a.Auctioneer ?? null,
      saleName: a.SaleName ?? null,
      lotNo: a.LotNumV2 ?? (a.LotNo != null ? String(a.LotNo) : null),
      certNo: a.CertNo ?? null,
      price: typeof a.Price === "number" ? a.Price : null,
      isCac: Boolean(a.IsCAC),
      service: a.Service ?? null,
      url: a.AuctionLotUrl ?? null,
    }))
    // newest first when dates are parseable
    .sort((x, y) => {
      const dx = x.date ? Date.parse(x.date) : 0;
      const dy = y.date ? Date.parse(y.date) : 0;
      return dy - dx;
    });
}
