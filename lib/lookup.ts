/**
 * Orchestration layer: given an ExtractedSlab from the vision model,
 * resolve it against CDN and return a fully-priced row for the review UI.
 *
 * Strategy:
 *   1. If we have a pcgs_number and a numeric grade  →  /GetPricingRequest by PcgsNumber
 *   2. Else if we have a gsid (e.g. cached from previous scan) →  /GetPricingRequest by Gsid
 *   3. Else (no PCGS#)                              →  return UNRESOLVED, surface to UI
 *      so Ben can pick from candidate matches or paste a Gsid manually.
 *
 * The UI then lets Ben:
 *   - confirm/edit any vision field and re-run priceSlab
 *   - manually set a Gsid (e.g. by searching greysheet.com)
 */

import { cdn, summarisePricing, type SlabPricingSummary } from "@/lib/cdn";
import type { ExtractedSlab } from "@/lib/vision";
import { hasCdnCreds } from "@/lib/env";

export type LookupStatus =
  | "priced"          // got real bid/ask
  | "no-pricing"      // CDN found the coin but had no prices for that grade
  | "needs-mapping"   // we don't have a pcgs# / gsid; Ben must map manually
  | "no-credentials"  // CDN_API_KEY/TOKEN aren't set yet (dev mode)
  | "error";

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

  // Strategy 1: PCGS coin number from the label.
  if (slab.pcgs_number) {
    try {
      const resp = await cdn.getPricing({
        pcgsNumber: slab.pcgs_number,
        grade,
        advanced: true,
      });
      const item = resp.Data?.[0];
      if (!item) {
        return {
          slab,
          pricing: null,
          status: "needs-mapping",
          errorMessage: `CDN returned no item for PCGS#${slab.pcgs_number}`,
          spreadDollars: null,
          spreadPercent: null,
        };
      }
      const pricing = summarisePricing(item, grade, slab.has_cac_sticker);
      return finalize(slab, pricing);
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

  // No PCGS# — Ben must pick a Gsid in the UI.
  return {
    slab,
    pricing: null,
    status: "needs-mapping",
    errorMessage: "No PCGS# on label; map this slab to a CDN coin manually.",
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
    const resp = await cdn.getPricing({ gsid, grade, advanced: true });
    const item = resp.Data?.[0];
    if (!item) {
      return {
        slab,
        pricing: null,
        status: "needs-mapping",
        errorMessage: `CDN returned no item for Gsid ${gsid}`,
        spreadDollars: null,
        spreadPercent: null,
      };
    }
    const pricing = summarisePricing(item, grade, slab.has_cac_sticker);
    return finalize(slab, pricing);
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

function finalize(slab: ExtractedSlab, pricing: SlabPricingSummary | null): PricedSlab {
  const status: LookupStatus = !pricing
    ? "no-pricing"
    : pricing.bid == null && pricing.ask == null
      ? "no-pricing"
      : "priced";

  const ask = slab.handwritten_ask_price;
  const bid = pricing?.bid ?? null;
  const spreadDollars = ask != null && bid != null ? ask - bid : null;
  const spreadPercent = ask != null && bid && bid > 0 ? (ask - bid) / bid : null;

  return { slab, pricing, status, spreadDollars, spreadPercent };
}
