/**
 * Catalog-walk resolver for slabs that don't have a PCGS coin number on the
 * label (typically NGC / ANACS / ICG). We use CDN's `GetCollectibleByNodeRequest`
 * to enumerate every collectible under a series-level node, then match by
 * year + mint + variety.
 *
 * Built on top of a small hand-curated denomination → parent-node map at
 * `data/cdn-node-map.json`. The map only needs to cover the denominations Ben
 * actually sees in dealer photos; we can extend it by running
 * `scripts/cdn-build-node-map.ts`.
 */

import { cdn, type CdnCollectible } from "@/lib/cdn";
import nodeMap from "@/data/cdn-node-map.json";

/** Normalise free text for matching. */
function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Map a free-text denomination (from vision / Ben's edit) to a CDN node id. */
export function resolveDenominationNodeId(
  denomination: string | null | undefined,
  year: string | null | undefined,
): number | null {
  if (!denomination) return null;
  const n = norm(denomination);
  if (!n) return null;

  // Pick the entry whose `aliases` includes the normalised denomination,
  // and whose optional `yearMin/yearMax` window (if present) contains `year`.
  const y = year ? Number(year.replace(/[^0-9]/g, "").slice(0, 4)) : null;

  for (const entry of nodeMap as NodeMapEntry[]) {
    const matchedAlias = entry.aliases.some((a) => norm(a) === n || n.includes(norm(a)));
    if (!matchedAlias) continue;
    if (y != null) {
      if (entry.yearMin != null && y < entry.yearMin) continue;
      if (entry.yearMax != null && y > entry.yearMax) continue;
    }
    return entry.nodeId;
  }
  return null;
}

export interface NodeMapEntry {
  /** Friendly label (Lincoln Cent, Morgan Dollar, etc.). */
  series: string;
  /** Strings the vision pass might emit. Case- & punctuation-insensitive. */
  aliases: string[];
  /** CDN parent node id under which all year+mint variations live. */
  nodeId: number;
  /** Optional year window when the same denom maps to multiple series (e.g. Lincoln vs Indian Head cents). */
  yearMin?: number;
  yearMax?: number;
}

/**
 * Walk all collectibles under a CDN node and find the one matching
 * year + mint + (optional) variety. Returns the matched collectible's Gsid
 * or null if no good match.
 *
 * We compare:
 *   CoinDate (numeric prefix) === year
 *   MintMark (normalised)      === mint
 *   Variety (normalised contains) — only used as a tiebreaker
 */
export async function findGsidByCatalogWalk(opts: {
  nodeId: number;
  year: string | null;
  mintMark: string | null;
  variety?: string | null;
  designation?: string | null;
}): Promise<{ gsid: number; collectible: CdnCollectible } | null> {
  const resp = await cdn.getCollectiblesByNode(opts.nodeId, false);
  const items = resp.Data ?? [];
  if (!items.length) return null;

  const wantYear = opts.year ? Number(opts.year.replace(/[^0-9]/g, "").slice(0, 4)) : null;
  const wantMint = norm(opts.mintMark);
  const wantVar = norm(opts.variety);

  // Some catalogs use "P" for Philadelphia, others use blank. Normalise both.
  const mintEq = (a: string, b: string) => {
    const A = a === "p" ? "" : a;
    const B = b === "p" ? "" : b;
    return A === B;
  };

  // Score every candidate
  const scored = items
    .map((c) => {
      const cYear = Number(String(c.CoinDate ?? "").replace(/[^0-9]/g, "").slice(0, 4));
      const cMint = norm(c.MintMark);
      const cVar = norm(`${c.Variety ?? ""} ${c.Variety2 ?? ""}`);
      const cDesg = norm(c.Desg);

      let score = 0;
      if (wantYear != null && cYear === wantYear) score += 50;
      else if (wantYear != null && Math.abs(cYear - wantYear) <= 1) score += 10;
      if (mintEq(cMint, wantMint)) score += 30;
      if (wantVar && cVar.includes(wantVar)) score += 15;
      if (opts.designation && cDesg.includes(norm(opts.designation))) score += 5;
      // Slight penalty for "Type" / "Set" rollup rows — we want a leaf coin
      if (c.IsType) score -= 5;
      if (c.IsSet) score -= 5;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score < 50) return null; // require at least year match
  return { gsid: top.c.Gsid, collectible: top.c };
}
