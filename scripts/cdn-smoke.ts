/**
 * Smoke-test the CDN client end-to-end without spinning up Next.js.
 *
 * Usage:
 *   pnpm tsx scripts/cdn-smoke.ts                    # default coin
 *   pnpm tsx scripts/cdn-smoke.ts 7160 65            # PCGS# + grade
 *   pnpm tsx scripts/cdn-smoke.ts --gsid 12345 65    # by GSID
 *
 * Reads CDN_API_KEY / CDN_API_TOKEN from .env.local.
 *
 * What it does:
 *   1. /GetNodeRequest        – cheapest sanity-check call (root node)
 *   2. /GetPricingRequest     – the one Ben actually cares about
 *   3. Prints the summarised bid/ask + raw row
 *
 * Exit code is 0 on success, non-zero on any HTTP / shape error so you can
 * wire this into CI later.
 */

import "dotenv/config";
import { cdn, summarisePricing } from "../lib/cdn";
import { hasCdnCreds } from "../lib/env";

async function main() {
  if (!hasCdnCreds()) {
    console.error(
      "✗ CDN_API_KEY / CDN_API_TOKEN are not set. Add them to .env.local first.",
    );
    process.exit(2);
  }

  const args = process.argv.slice(2);
  let gsid: number | undefined;
  let pcgsNumber: string | undefined = "7160"; // 1881-S Morgan $1 — a classic
  let grade = 65;

  if (args[0] === "--gsid" && args[1]) {
    gsid = Number(args[1]);
    pcgsNumber = undefined;
    if (args[2]) grade = Number(args[2]);
  } else if (args[0]) {
    pcgsNumber = args[0];
    if (args[1]) grade = Number(args[1]);
  }

  console.log("• Step 1: /GetNodeRequest (root) ...");
  try {
    const root = await cdn.getNode(1);
    console.log(`  ✓ got node: ${root.Data?.[0]?.Name ?? "(no name)"}`);
  } catch (e: any) {
    console.error("  ✗ failed:", e?.message ?? e);
    process.exit(1);
  }

  console.log(
    `• Step 2: /GetPricingRequest (${
      gsid ? `GsId=${gsid}` : `PcgsNumber=${pcgsNumber}`
    }, grade=${grade}) ...`,
  );
  try {
    const resp = await cdn.getPricing({
      gsid,
      pcgsNumber,
      grade,
      advanced: true,
    });
    const item = resp.Data?.[0];
    if (!item) {
      console.error("  ✗ no Data returned");
      process.exit(1);
    }
    console.log(`  ✓ ${item.Name} (GsId ${item.GsId})`);
    const summary = summarisePricing(item, grade, false);
    console.log("  summary:", summary);
  } catch (e: any) {
    console.error("  ✗ failed:", e?.message ?? e);
    process.exit(1);
  }

  console.log("✓ All CDN calls succeeded.");
}

main().catch((e) => {
  console.error("Unhandled:", e);
  process.exit(1);
});
