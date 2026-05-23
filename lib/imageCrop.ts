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

const MAX_VISION_SIDE = 1600;      // px — used for the detector pass (whole tray)
const PER_SLAB_VISION_SIDE = 1280; // px — long edge of a cropped single-slab vision image
const THUMB_SIDE = 480;            // px — long edge of slab thumbnail

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

/**
 * Crop a single slab out of the FULL-RES source buffer with optional padding,
 * then resize for vision OCR (longest side ~1280px, high quality JPEG).
 *
 * @param sourceBuf  the ORIGINAL, full-resolution image buffer
 * @param cropBox    [x, y, w, h] in 0..1 fractions of the source image
 * @param padPct     additional padding around the box (fraction of source dims,
 *                   default 0.04 = 4%). Helps capture CAC stickers / price tags
 *                   that sit on the edge of the slab.
 */
export async function cropForVision(
  sourceBuf: Buffer,
  cropBox: [number, number, number, number],
  padPct = 0.04,
): Promise<{ buf: Buffer; dataUrl: string; mediaType: "image/jpeg" }> {
  const img = sharp(sourceBuf);
  const meta = await img.metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error("cropForVision: could not read image dimensions");

  const [nx, ny, nw, nh] = cropBox;
  const padX = padPct * W;
  const padY = padPct * H;

  let left = Math.floor(nx * W - padX);
  let top = Math.floor(ny * H - padY);
  let width = Math.ceil(nw * W + padX * 2);
  let height = Math.ceil(nh * H + padY * 2);

  // Clamp
  if (left < 0) {
    width += left;
    left = 0;
  }
  if (top < 0) {
    height += top;
    top = 0;
  }
  if (left + width > W) width = W - left;
  if (top + height > H) height = H - top;
  width = Math.max(1, width);
  height = Math.max(1, height);

  const out = await sharp(sourceBuf)
    .extract({ left, top, width, height })
    .resize({
      width: width >= height ? PER_SLAB_VISION_SIDE : undefined,
      height: height > width ? PER_SLAB_VISION_SIDE : undefined,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 92 })
    .toBuffer();

  return {
    buf: out,
    dataUrl: `data:image/jpeg;base64,${out.toString("base64")}`,
    mediaType: "image/jpeg",
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
