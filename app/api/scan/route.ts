/**
 * POST /api/scan
 *
 * Multipart upload of a dealer photo. Pipeline:
 *   1. Read file → Buffer
 *   2. Resize for the vision model (sharp)
 *   3. extractSlabsFromImage  →  ExtractedSlab[]
 *   4. priceAll               →  PricedSlab[]
 *   5. Save in-memory scan session, return its id.
 *
 * Front-end then navigates to /scan/[id] to review.
 */

import { NextResponse } from "next/server";
import { resizeForVision } from "@/lib/imageCrop";
import { extractSlabsFromImage } from "@/lib/vision";
import { priceAll } from "@/lib/lookup";
import { createScan } from "@/lib/scanStore";

export const runtime = "nodejs";
export const maxDuration = 60; // vision + N CDN calls can take a bit

const MAX_BYTES = 20 * 1024 * 1024; // 20MB hard cap

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });

  const file = form.get("file");
  const source = String(form.get("source") ?? "");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (${file.size} bytes, max ${MAX_BYTES})` }, { status: 413 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 415 });
  }

  const sourceBuf = Buffer.from(await file.arrayBuffer());

  // 1. Build a downscaled image for the detector pass (whole-tray view).
  //    The per-slab pass crops from the ORIGINAL full-res buffer for max OCR fidelity.
  const prepared = await resizeForVision(sourceBuf);

  // 2. Two-pass vision extraction (detector → per-slab Claude calls)
  let vision;
  try {
    vision = await extractSlabsFromImage(sourceBuf, prepared.dataUrl);
  } catch (e: any) {
    console.error("[scan] vision failed", e);
    return NextResponse.json({ error: `Vision failed: ${e?.message ?? e}` }, { status: 502 });
  }

  // 3. Price every slab in parallel (gracefully handles missing CDN creds)
  const rows = await priceAll(vision.slabs);

  // 4. Stash the session (keep the resized image — small enough to live in memory)
  const session = await createScan({
    sourceDataUrl: prepared.dataUrl,
    sourceMimeType: "image/jpeg",
    sourceFilename: file.name || "scan.jpg",
    source,
    vision,
    rows,
  });

  return NextResponse.json({
    id: session.id,
    slabCount: vision.slabs.length,
  });
}
