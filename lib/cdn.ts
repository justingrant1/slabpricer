/**
 * Typed client for the CDN Public Collector's Pricing Guide (CPG) API v2.
 * Matches cpg-api-v2-documentation.md.
 *
 * All endpoints are GETs, auth is via x-api-key + x-api-token headers.
 */

import { env } from "@/lib/env";

// ---------- Types pulled from the OpenAPI doc ----------

export interface CdnEnvelope<T> {
  Data: T[];
  Total: number;
  OpCode: number;
  ErrorText: string;
  RequestTime: string;
  ResponseTime: string;
  TotalExecutionTime: string;
  CachedResponse: boolean;
  PermitAccess: boolean;
  AccessDeniedMessage: string;
}

export interface CdnNode {
  Id: number;
  Name: string;
  Description: string;
  FeaturedImageUrl: string;
  FeaturedImageAttribution: string;
  FlagCode: string;
  CountryName: string;
  SortingPosition: number;
  NodeChildrenCountLive: number;
  CollectibleChildrenCountLive: number;
  ParentNode_Id: number;
  RootNode_Id: number;
  ChildNodes: string[];
}

export interface CdnCollectible {
  Gsid: number;
  UiParentId: number;
  Name: string;
  PcgsNumber: string;
  FriedbergNumber: string;
  CoinDate: string;
  DenominationShort: string;
  DenominationLong: string;
  Variety: string;
  Variety2: string;
  Desg: string;
  Other: string;
  Prefix: string;
  MintMark: string;
  Composition: string;
  Mintage: string;
  StrikeType: string;
  Diameter: string;
  Fineness: string;
  WeightGrams: number;
  WeightOunces: number;
  Designer: string;
  Edge: string;
  Rarity: string;
  CoinShape: string;
  Description: string;
  GeneralNotes: string;
  Ngc: string;
  NgcId: number;
  Krause: string;
  FeaturedImageUrl: string;
  IsType: boolean;
  IsSet: boolean;
  PriceLow: number;
  PriceHigh: number;
  RootNode_Id: number;
  ParentNode_Id: number;
  ParentNodeName: string;
  SortingPosition: number;
  CatalogPath: CdnNode[];
  // ...many other optional fields documented in the markdown; we keep this loose:
  [extra: string]: unknown;
}

export interface CdnPricingData {
  Grade: number;
  GradeLabel: string;
  IsCac: boolean;
  CpgVal: string;
  GreyVal: string;
  PcgsVal: string;
  NgcVal: string;
  BlueBookVal: string;
}

export interface CdnPricingItem {
  GsId: number;
  Name: string;
  SortingPosition: number;
  IsType: boolean;
  IsSet: boolean;
  UiParentId: number;
  PricingData: CdnPricingData[];
}

// ---------- Low-level GET helper ----------

class CdnError extends Error {
  constructor(message: string, public readonly status?: number, public readonly opCode?: number) {
    super(message);
    this.name = "CdnError";
  }
}

async function cdnGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<CdnEnvelope<T>> {
  const url = new URL(path, env.CDN_BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-api-key": env.CDN_API_KEY,
      "x-api-token": env.CDN_API_TOKEN,
      Accept: "application/json",
    },
    // CDN data is reasonably static; let Next cache for an hour for catalog,
    // but pricing callers can override.
    next: { revalidate: 60 * 60 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CdnError(`CDN ${path} HTTP ${res.status}: ${body.slice(0, 300)}`, res.status);
  }

  const json = (await res.json()) as CdnEnvelope<T>;

  if (json.OpCode && json.OpCode !== 0 && json.OpCode !== 200) {
    throw new CdnError(`CDN ${path} OpCode ${json.OpCode}: ${json.ErrorText || "unknown error"}`, res.status, json.OpCode);
  }
  if (json.PermitAccess === false) {
    throw new CdnError(`CDN access denied: ${json.AccessDeniedMessage || ""}`, res.status);
  }
  return json;
}

// ---------- Public API ----------

export const cdn = {
  /** GET /GetNodeRequest — retrieve a single node */
  async getNode(nodeId: number): Promise<CdnEnvelope<CdnNode>> {
    return cdnGet<CdnNode>("/GetNodeRequest", { NodeId: nodeId });
  },

  /** GET /GetNodeChildrenRequest — list child nodes for a node */
  async getNodeChildren(nodeId: number): Promise<CdnEnvelope<CdnNode>> {
    return cdnGet<CdnNode>("/GetNodeChildrenRequest", { NodeId: nodeId });
  },

  /**
   * GET /GetCollectibleRequest — look up a collectible by Greysheet ID.
   * Pass ApiLevel='Advanced' for the full payload.
   */
  async getCollectible(gsid: number, advanced = true): Promise<CdnEnvelope<CdnCollectible>> {
    return cdnGet<CdnCollectible>("/GetCollectibleRequest", {
      GsId: gsid,
      ApiLevel: advanced ? "Advanced" : undefined,
    });
  },

  /** GET /GetCollectibleByNodeRequest — list all collectibles under a node */
  async getCollectiblesByNode(nodeId: number, advanced = false): Promise<CdnEnvelope<CdnCollectible>> {
    return cdnGet<CdnCollectible>("/GetCollectibleByNodeRequest", {
      NodeId: nodeId,
      ApiLevel: advanced ? "Advanced" : undefined,
    });
  },

  /**
   * GET /GetPricingRequest — the workhorse for Ben.
   * Either gsid OR pcgsNumber is required. Grade narrows the PricingData array.
   */
  async getPricing(opts: {
    gsid?: number;
    pcgsNumber?: string;
    frNumber?: string;
    ngcId?: number;
    grade?: number;
    minGrade?: number;
    maxGrade?: number;
    advanced?: boolean;
  }): Promise<CdnEnvelope<CdnPricingItem>> {
    if (!opts.gsid && !opts.pcgsNumber) {
      throw new CdnError("getPricing requires gsid or pcgsNumber");
    }
    return cdnGet<CdnPricingItem>("/GetPricingRequest", {
      Gsid: opts.gsid,
      PcgsNumber: opts.pcgsNumber,
      FrNumber: opts.frNumber,
      NgcId: opts.ngcId,
      Grade: opts.grade,
      MinGrade: opts.minGrade,
      MaxGrade: opts.maxGrade,
      ApiLevel: opts.advanced ? "Advanced" : undefined,
    });
  },
};

// ---------- Convenience helpers used by the app ----------

/** Parse a CDN price string ("$1,234.50" or "1234.5" or "—") into a number or null. */
export function parseCdnPrice(v: string | null | undefined): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Find the PricingData row that matches a numeric grade, optionally CAC-only. */
export function pickPricingForGrade(
  item: CdnPricingItem,
  grade: number,
  cac = false,
): CdnPricingData | null {
  if (!item?.PricingData?.length) return null;
  const exact = item.PricingData.find((p) => p.Grade === grade && (cac ? p.IsCac : !p.IsCac));
  if (exact) return exact;
  // fallback: any row at that grade
  return item.PricingData.find((p) => p.Grade === grade) ?? null;
}

/**
 * Summarised pricing for a single slab — what the UI actually displays.
 *   bid  = Greysheet wholesale bid
 *   ask  = CPG retail ask
 */
export interface SlabPricingSummary {
  gsid: number | null;
  name: string;
  grade: number;
  gradeLabel: string;
  isCac: boolean;
  bid: number | null; // GreyVal
  ask: number | null; // CpgVal
  pcgs: number | null;
  ngc: number | null;
  blueBook: number | null;
  rawCdn: CdnPricingItem | null;
}

export function summarisePricing(
  item: CdnPricingItem,
  grade: number,
  cac = false,
): SlabPricingSummary | null {
  const row = pickPricingForGrade(item, grade, cac);
  if (!row) {
    return {
      gsid: item.GsId ?? null,
      name: item.Name,
      grade,
      gradeLabel: String(grade),
      isCac: cac,
      bid: null,
      ask: null,
      pcgs: null,
      ngc: null,
      blueBook: null,
      rawCdn: item,
    };
  }
  return {
    gsid: item.GsId ?? null,
    name: item.Name,
    grade: row.Grade,
    gradeLabel: row.GradeLabel,
    isCac: row.IsCac,
    bid: parseCdnPrice(row.GreyVal),
    ask: parseCdnPrice(row.CpgVal),
    pcgs: parseCdnPrice(row.PcgsVal),
    ngc: parseCdnPrice(row.NgcVal),
    blueBook: parseCdnPrice(row.BlueBookVal),
    rawCdn: item,
  };
}

export { CdnError };
