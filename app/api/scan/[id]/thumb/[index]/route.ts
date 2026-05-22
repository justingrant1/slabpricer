/**
 * GET /api/scan/[id]/thumb/[index]
 *
 * Streams a JPEG thumbnail of slab [index] from the in-memory scan.
 * Uses the crop_box the vision model emitted to extract just that slab.
 */

import { NextResponse } from "next/server";
import { getScan } from "@/lib/scanStore";
import { cropSlabThumb } from "@/lib/imageCrop";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string; index: string } }) {
  const scan = getScan(params.id);
  if (!scan) return new NextResponse("Not found", { status: 404 });

  const index = Number(params.index);
  const slab = scan.vision.slabs.find((s) => s.index === index);
  if (!slab) return new NextResponse("Slab not found", { status: 404 });

  // sourceDataUrl is "data:image/jpeg;base64,..."
  const b64 = scan.sourceDataUrl.split(",")[1] ?? "";
  const srcBuf = Buffer.from(b64, "base64");

  const thumb = await cropSlabThumb(srcBuf, slab.crop_box);
  return new NextResponse(Buffer.from(thumb.base64, "base64"), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
