/**
 * sharp-based image utilities.
 *
 *  - cropSlabThumb: given the original photo and a normalized crop_box
 *    [x,y,w,h] (each 0..1), produce a small JPEG thumbnail of just that slab.
 *  - resizeForVision: shrink really large dealer photos before sending to
 *    OpenAI so we don't waste tokens / hit size limits.
 */

import sharp from "sharp";

export interface Thumb {
  /** base64-encoded JPEG bytes, no data: prefix */
  base64: string;
  /** "data:image/jpeg;base64,..." convenience */
  dataUrl: string;
  width: number;
  height: number;
}

const MAX_VISION_SIDE = 1600; // px — plenty for slab OCR, well under model limits
const THUMB_SIDE = 480;       // px — long edge of slab thumbnail

/** Crop a single slab thumbnail out of the master photo. */
export async function cropSlabThumb(
  sourceBuf: Buffer,
  cropBox: [number, number, number, number],
): Promise<Thumb> {
  const img = sharp(sourceBuf);
  const meta = await img.metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error("cropSlabThumb: could not read image dimensions");

  const [nx, ny, nw, nh] = cropBox;
  const left = Math.max(0, Math.floor(nx * W));
  const top = Math.max(0, Math.floor(ny * H));
  const width = Math.max(1, Math.min(W - left, Math.floor(nw * W)));
  const height = Math.max(1, Math.min(H - top, Math.floor(nh * H)));

  const cropped = await sharp(sourceBuf)
    .extract({ left, top, width, height })
    .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  const out = await sharp(cropped).metadata();
  const b64 = cropped.toString("base64");
  return {
    base64: b64,
    dataUrl: `data:image/jpeg;base64,${b64}`,
    width: out.width ?? 0,
    height: out.height ?? 0,
  };
}

/** Resize an oversized photo to a sane maximum side, keeping aspect ratio. */
export async function resizeForVision(sourceBuf: Buffer): Promise<{ buf: Buffer; dataUrl: string }> {
  const meta = await sharp(sourceBuf).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const long = Math.max(W, H);

  let out: Buffer;
  if (long > MAX_VISION_SIDE) {
    out = await sharp(sourceBuf)
      .resize({ width: W >= H ? MAX_VISION_SIDE : undefined, height: H > W ? MAX_VISION_SIDE : undefined, fit: "inside" })
      .jpeg({ quality: 90 })
      .toBuffer();
  } else {
    // Re-encode as JPEG to normalize regardless of input type.
    out = await sharp(sourceBuf).jpeg({ quality: 92 }).toBuffer();
  }
  return {
    buf: out,
    dataUrl: `data:image/jpeg;base64,${out.toString("base64")}`,
  };
}
