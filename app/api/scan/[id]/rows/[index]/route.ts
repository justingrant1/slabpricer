/**
 * PATCH /api/scan/[id]/rows/[index]
 *
 * Re-run pricing for a single slab after Ben edits its fields.
 * Body JSON:
 *   {
 *     slab: ExtractedSlab,           // updated/edited fields
 *     overrideGsid?: number          // if Ben manually mapped a coin
 *   }
 *
 * Returns the new PricedSlab and the updated scan session.
 */

import { NextResponse } from "next/server";
import { getScan, updateRow } from "@/lib/scanStore";
import { priceSlab, priceSlabByGsid } from "@/lib/lookup";
import type { ExtractedSlab } from "@/lib/vision";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; index: string } },
) {
  const scan = await getScan(params.id);
  if (!scan) return NextResponse.json({ error: "Scan not found" }, { status: 404 });

  const index = Number(params.index);
  if (!Number.isFinite(index)) {
    return NextResponse.json({ error: "Bad row index" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    slab: ExtractedSlab;
    overrideGsid?: number;
  };
  if (!body.slab) return NextResponse.json({ error: "Missing slab" }, { status: 400 });

  const priced = body.overrideGsid
    ? await priceSlabByGsid(body.slab, body.overrideGsid)
    : await priceSlab(body.slab);

  const next = await updateRow(params.id, index, priced);
  if (!next) return NextResponse.json({ error: "Row not found" }, { status: 404 });

  return NextResponse.json({ row: priced });
}
