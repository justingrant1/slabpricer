/**
 * POST /api/scan/[id]/commit
 *
 * Writes the (possibly edited) scan to Airtable:
 *   - 1 row in Scans (with the original photo)
 *   - N rows in Slabs (with per-slab thumbnails)
 *
 * Body JSON:
 *   {
 *     rows: Array<{
 *       index: number;                                              // matches slab.index
 *       decision?: "Buy" | "Pass" | "Negotiate" | "Pending";
 *       finalOffer?: number | null;
 *       notes?: string;
 *     }>;
 *     notes?: string;
 *     source?: string;
 *   }
 *
 * If a row in `rows` has no entry, we still commit the slab with current values
 * (and Decision = Pending).
 */

import { NextResponse } from "next/server";
import { getScan, deleteScan } from "@/lib/scanStore";
import { commitScan } from "@/lib/airtable";
import { cropSlabThumb } from "@/lib/imageCrop";

export const runtime = "nodejs";
export const maxDuration = 60;

interface BodyRow {
  index: number;
  decision?: "Buy" | "Pass" | "Negotiate" | "Pending";
  finalOffer?: number | null;
  notes?: string;
}
interface Body {
  rows?: BodyRow[];
  notes?: string;
  source?: string;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const scan = getScan(params.id);
  if (!scan) return NextResponse.json({ error: "Scan not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const rowOverrides = new Map<number, BodyRow>(
    (body.rows ?? []).map((r) => [r.index, r]),
  );

  // Generate per-slab thumbnails from the original
  const b64 = scan.sourceDataUrl.split(",")[1] ?? "";
  const srcBuf = Buffer.from(b64, "base64");

  const rows = await Promise.all(
    scan.rows.map(async (priced) => {
      const override = rowOverrides.get(priced.slab.index);
      const thumb = await cropSlabThumb(srcBuf, priced.slab.crop_box);
      return {
        priced,
        thumbnailDataUrl: thumb.dataUrl,
        decision: override?.decision ?? "Pending",
        finalOffer: override?.finalOffer ?? null,
        notesOverride: override?.notes,
      };
    }),
  );

  try {
    const result = await commitScan({
      scanSourceFilename: scan.sourceFilename,
      sourceDealer: body.source ?? scan.source,
      notes: body.notes,
      photoDataUrl: scan.sourceDataUrl,
      rows,
    });
    deleteScan(params.id);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[commit] Airtable commit failed", e);
    const detail =
      typeof e === "object" && e
        ? e.message ?? e.error ?? JSON.stringify(e)
        : String(e);
    return NextResponse.json(
      { error: `Airtable commit failed: ${detail}` },
      { status: 502 },
    );
  }
}
