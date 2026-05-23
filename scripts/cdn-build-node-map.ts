/**
 * One-shot crawler that walks the U.S. coins section of the CDN catalog and
 * prints a starter `cdn-node-map.json` to stdout.
 *
 * Usage:
 *   pnpm tsx scripts/cdn-build-node-map.ts > data/cdn-node-map.json
 *
 * Note: the seed map at data/cdn-node-map.json was hand-curated to match the
 * CDN node ids that exist as of writing. If CDN reorganizes its tree, re-run
 * this script and review the diff before committing.
 *
 * The script walks two levels deep from the U.S. root and emits one entry per
 * series-level node whose name matches a known denomination. You'll want to
 * manually annotate `aliases` and `yearMin/yearMax` afterwards.
 */

import { cdn } from "@/lib/cdn";
import type { NodeMapEntry } from "@/lib/cdnCatalog";

const US_ROOT_NODE_ID = Number(process.env.CDN_US_ROOT_NODE_ID ?? 1);

async function main() {
  const root = await cdn.getNodeChildren(US_ROOT_NODE_ID);
  const seriesNodes: { Name: string; Id: number }[] = [];

  for (const child of root.Data ?? []) {
    // Each top-level child is a denomination group; walk one level deeper.
    const sub = await cdn.getNodeChildren(child.Id);
    for (const s of sub.Data ?? []) {
      seriesNodes.push({ Name: `${child.Name} → ${s.Name}`, Id: s.Id });
    }
  }

  const entries: NodeMapEntry[] = seriesNodes.map((n) => ({
    series: n.Name,
    aliases: [n.Name.toLowerCase()],
    nodeId: n.Id,
  }));

  console.log(JSON.stringify(entries, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
