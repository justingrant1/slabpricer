/**
 * Two-pass Claude 3.5 Sonnet vision pipeline.
 *
 *   Pass 1 — Detector (one call on a 2048px-long-edge whole-tray image):
 *     Ask Claude to first COUNT the slabs (so it commits before it lists
 *     boxes — empirically the most reliable way to stop it from forgetting
 *     a row on 10+ slab trays), then return a bounding box + reading order
 *     for each one. NO field extraction.

 *
 *   Pass 2 — Per-slab extractor (N parallel calls, capped concurrency):
 *     For each detected box, sharp-crops the ORIGINAL full-res buffer to that
 *     slab with ~5% padding and re-encodes at 1280px / q92. Sends that focused
 *     crop to Claude with a prompt that asserts "exactly ONE slab in this
 *     image; extract its label fields." Each slab gets the full vision
 *     budget instead of 1/N of it.
 *
 * We use Anthropic's tool-use mechanism with strict input schemas to force
 * well-formed JSON output (vastly more reliable than parsing free text).
 *
 * Public API (`extractSlabsFromImage`) is unchanged — callers in
 * `app/api/scan/route.ts` and `lib/lookup.ts` don't need to change anything.
 */

import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { cropForVision } from "@/lib/imageCrop";

// ---------- Output shape (unchanged from v1) ----------

export type GradingService = "PCGS" | "NGC" | "ANACS" | "ICG" | "CAC" | "UNKNOWN";

export interface ExtractedSlab {
  index: number;
  grading_service: GradingService;
  cert_number: string | null;
  year: string | null;
  mint_mark: string | null;
  denomination: string | null;
  variety: string | null;
  grade_label: string | null;
  grade_numeric: number | null;
  designation: string | null;
  pcgs_number: string | null;
  has_cac_sticker: boolean;
  handwritten_ask_price: number | null;
  crop_box: [number, number, number, number];
  label_confidence: number;
  notes: string | null;
}

export interface VisionResult {
  slabs: ExtractedSlab[];
  global_notes: string | null;
  total_slabs_detected: number;
}

// ---------- Anthropic client ----------

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

// ---------- Pass 1: detector ----------

const DETECTOR_TOOL: Anthropic.Tool = {
  name: "report_slabs",
  description:
    "Report every coin slab visible in the photo with its bounding box in reading order (top-to-bottom, left-to-right). FIRST set slab_count to the total number of slabs you can see, THEN return exactly that many boxes.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["slab_count", "slabs"],
    properties: {
      slab_count: {
        type: "integer",
        description:
          "Total number of graded coin slabs visible in the photo. Count carefully BEFORE listing boxes — the slabs array length must equal this number.",
      },
      slabs: {

        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "crop_box"],
          properties: {
            index: {
              type: "integer",
              description: "1-based reading order index.",
            },
            crop_box: {
              type: "array",
              description:
                "[x, y, width, height] as fractions of the full image, 0..1. Must be tight around just this slab's plastic holder.",
              items: { type: "number" },
              minItems: 4,
              maxItems: 4,
            },
            label_confidence: {
              type: "number",
              description:
                "Your confidence (0..1) that this is in fact a graded coin slab and not noise / a price tag / a piece of paper.",
            },
          },
        },
      },
      global_notes: {
        type: ["string", "null"],
        description: "Any general handwritten text on the photo that wasn't tied to a single slab.",
      },
    },
  },
};

const DETECTOR_SYSTEM = `You are an expert at locating graded coin slabs in dealer photos.
A "slab" is a tamper-evident plastic holder (PCGS, NGC, ANACS, ICG) containing one coin.

Your job has TWO steps:

Step 1 — COUNT. Scan the entire photo, including every row and every corner.
Count the total number of slabs you see and set "slab_count" to that number.
Common dealer layouts include 3x3 grids, 3x4 grids, and 2 or 3 rows with a
longer bottom row. Don't stop at the first row — sweep every row.

Step 2 — LOCATE. Return one entry in the "slabs" array per slab, in reading
order (top to bottom, then left to right). The slabs array length MUST equal
slab_count. Each box must be tight around just that one slab's plastic
holder.

Hard rules:
- Each slab is a SEPARATE tamper-evident holder. Do NOT merge two adjacent
  slabs into a single box, even when they're touching. A row with 4 slabs
  requires 4 boxes for that row.
- The handwritten asking-price sticker is part of the slab it sits on — do
  not list it as its own slab.
- Do NOT extract label text — that is a separate step.`;


interface DetectorBox {
  index: number;
  crop_box: [number, number, number, number];
  label_confidence?: number;
}

async function detectSlabs(downscaledDataUrl: string): Promise<{
  boxes: DetectorBox[];
  reportedCount: number | null;
  global_notes: string | null;
}> {

  const { mediaType, base64 } = splitDataUrl(downscaledDataUrl);

  const resp = await client().messages.create({
    model: env.ANTHROPIC_VISION_MODEL,
    max_tokens: 1024,
    system: DETECTOR_SYSTEM,
    tools: [DETECTOR_TOOL],
    tool_choice: { type: "tool", name: "report_slabs" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: "Step 1: count every graded coin slab in this photo and set slab_count to that integer. Step 2: return exactly slab_count boxes, one per slab, in reading order (top to bottom, then left to right). The slabs array length must equal slab_count — double-check before submitting.",
          },
        ],
      },
    ],
  });

  const block = resp.content.find((b) => b.type === "tool_use") as
    | Anthropic.ToolUseBlock
    | undefined;
  if (!block) throw new Error("Detector: model did not return a tool_use block");
  const input = block.input as {
    slab_count?: number;
    slabs?: DetectorBox[];
    global_notes?: string | null;
  };
  const raw = input.slabs ?? [];
  const reportedCount =
    typeof input.slab_count === "number" ? input.slab_count : null;

  const boxes: DetectorBox[] = raw
    .map((b, i) => ({
      index: i + 1, // re-number to be safe; Claude sometimes skips numbers
      crop_box: clampBox(b.crop_box),
      label_confidence: typeof b.label_confidence === "number" ? b.label_confidence : 0.9,
    }))
    .filter((b) => b.crop_box[2] > 0.02 && b.crop_box[3] > 0.02); // drop tiny garbage

  return {
    boxes,
    reportedCount,
    global_notes: input.global_notes ?? null,
  };
}


// ---------- Pass 2: per-slab extractor ----------

const SLAB_TOOL: Anthropic.Tool = {
  name: "report_slab_fields",
  description:
    "Report the printed label fields and any handwritten asking-price sticker for the single slab in this image.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "grading_service",
      "cert_number",
      "year",
      "mint_mark",
      "denomination",
      "variety",
      "grade_label",
      "grade_numeric",
      "designation",
      "pcgs_number",
      "has_cac_sticker",
      "handwritten_ask_price",
      "label_confidence",
      "notes",
    ],
    properties: {
      grading_service: {
        type: "string",
        enum: ["PCGS", "NGC", "ANACS", "ICG", "CAC", "UNKNOWN"],
      },
      cert_number: {
        type: ["string", "null"],
        description: "The long serial / certification number, digits only, no service prefix.",
      },
      year: { type: ["string", "null"] },
      mint_mark: { type: ["string", "null"] },
      denomination: { type: ["string", "null"] },
      variety: { type: ["string", "null"] },
      grade_label: {
        type: ["string", "null"],
        description: 'The grade as printed: "MS65", "PR67DCAM", "AU58", "Genuine", etc.',
      },
      grade_numeric: {
        type: ["integer", "null"],
        description: "The Sheldon-scale integer 1..70. null if Details/Genuine/ungradeable.",
      },
      designation: {
        type: ["string", "null"],
        description: "DCAM, CAM, FB, FBL, FH, PL, DMPL, etc. Do NOT put CAC here — use has_cac_sticker.",
      },
      pcgs_number: {
        type: ["string", "null"],
        description: "The short coin-type number printed on the label (e.g. 7160). NOT the cert number.",
      },
      has_cac_sticker: { type: "boolean" },
      handwritten_ask_price: {
        type: ["number", "null"],
        description:
          "USD asking price written on the sticker ON this slab. Read carefully — a handwritten '1.85' on a Morgan dollar sticker almost always means $185, not $1.85.",
      },
      label_confidence: { type: "number" },
      notes: { type: ["string", "null"] },
    },
  },
};

const SLAB_SYSTEM = `You are an expert numismatist reading a single graded coin slab.
The image contains EXACTLY ONE slab (PCGS, NGC, ANACS, or ICG holder).
Extract the printed label fields and any handwritten asking-price sticker
that is physically stuck onto this slab.

Rules:
- cert_number is the long serial number — digits only, no prefix.
- pcgs_number is the short coin-type number on the label (e.g. 7160 for an 1881-S Morgan). NOT the cert number.
- grade_numeric must be the Sheldon-scale integer (1–70). For Details/Genuine return null and put descriptor in grade_label.
- designation includes DCAM, CAM, FB, FBL, FH, PL, DMPL, etc. CAC goes in has_cac_sticker.
- handwritten_ask_price: USD number. Sticker prices like "1.85" on a Morgan dollar slab mean $185, not $1.85. Use coin context to disambiguate. If no sticker on THIS slab, return null.
- If you can't read a field with confidence, return null rather than guessing.
- label_confidence is your confidence (0..1) that year/denomination/grade are correct.`;

interface SlabFields {
  grading_service: GradingService;
  cert_number: string | null;
  year: string | null;
  mint_mark: string | null;
  denomination: string | null;
  variety: string | null;
  grade_label: string | null;
  grade_numeric: number | null;
  designation: string | null;
  pcgs_number: string | null;
  has_cac_sticker: boolean;
  handwritten_ask_price: number | null;
  label_confidence: number;
  notes: string | null;
}

async function extractSlabFields(
  slabImageDataUrl: string,
): Promise<SlabFields> {
  const { mediaType, base64 } = splitDataUrl(slabImageDataUrl);

  const resp = await client().messages.create({
    model: env.ANTHROPIC_VISION_MODEL,
    max_tokens: 1024,
    system: SLAB_SYSTEM,
    tools: [SLAB_TOOL],
    tool_choice: { type: "tool", name: "report_slab_fields" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: "Read every printed and handwritten detail on this slab and call report_slab_fields with the result.",
          },
        ],
      },
    ],
  });

  const block = resp.content.find((b) => b.type === "tool_use") as
    | Anthropic.ToolUseBlock
    | undefined;
  if (!block) throw new Error("Slab extractor: model did not return a tool_use block");

  const fields = block.input as Partial<SlabFields>;
  // Fill in safe defaults
  return {
    grading_service: (fields.grading_service as GradingService) ?? "UNKNOWN",
    cert_number: fields.cert_number ?? null,
    year: fields.year ?? null,
    mint_mark: fields.mint_mark ?? null,
    denomination: fields.denomination ?? null,
    variety: fields.variety ?? null,
    grade_label: fields.grade_label ?? null,
    grade_numeric: fields.grade_numeric ?? null,
    designation: fields.designation ?? null,
    pcgs_number: fields.pcgs_number ?? null,
    has_cac_sticker: Boolean(fields.has_cac_sticker),
    handwritten_ask_price:
      typeof fields.handwritten_ask_price === "number"
        ? fields.handwritten_ask_price
        : null,
    label_confidence:
      typeof fields.label_confidence === "number" ? fields.label_confidence : 0.5,
    notes: fields.notes ?? null,
  };
}

// ---------- Orchestrator ----------

/**
 * Top-level entry point used by /api/scan and /api/lookup.
 *
 * @param fullResBuf       the ORIGINAL full-resolution photo (for accurate crops)
 * @param detectorImageUrl a downscaled (~1600px) data URL for the detector pass
 */
export async function extractSlabsFromImage(
  arg1: Buffer | string,
  arg2?: string,
): Promise<VisionResult> {
  // Backwards-compat: if callers still pass a single data URL string, we'll
  // use it for both passes (works fine, just slightly less crisp on big trays).
  let fullResBuf: Buffer;
  let detectorDataUrl: string;

  if (typeof arg1 === "string") {
    detectorDataUrl = arg1;
    fullResBuf = bufferFromDataUrl(arg1);
  } else {
    fullResBuf = arg1;
    if (!arg2) throw new Error("extractSlabsFromImage: second arg (detector data URL) is required when first arg is a Buffer");
    detectorDataUrl = arg2;
  }

  // ---- Pass 1: locate every slab ----
  const { boxes, reportedCount, global_notes: detectorNotes } =
    await detectSlabs(detectorDataUrl);
  console.log(
    `[vision] detector found ${boxes.length} slab(s)` +
      (reportedCount !== null ? ` (model reported ${reportedCount})` : ""),
  );

  // If the model said it saw N slabs but only returned M boxes, surface that
  // so Ben knows to eyeball the source image — boxes.length is authoritative
  // for downstream, but the mismatch is a strong "look here" signal.
  let global_notes = detectorNotes;
  if (
    reportedCount !== null &&
    reportedCount > 0 &&
    reportedCount !== boxes.length
  ) {
    const warn = `⚠️ Detector reported ${reportedCount} slab(s) but only returned ${boxes.length} box(es). One or more may be missing — check the source image.`;
    console.warn(`[vision] ${warn}`);
    global_notes = global_notes ? `${warn}\n${global_notes}` : warn;
  }

  if (boxes.length === 0) {
    return { slabs: [], global_notes, total_slabs_detected: 0 };
  }


  // ---- Pass 2: extract fields per slab, bounded concurrency ----
  const slabs = await mapWithConcurrency(boxes, 4, async (box) => {
    try {
      const crop = await cropForVision(fullResBuf, box.crop_box, 0.04);
      const fields = await extractSlabFields(crop.dataUrl);
      const slab: ExtractedSlab = {
        index: box.index,
        crop_box: box.crop_box,
        ...fields,
      };
      return slab;
    } catch (e: any) {
      console.error(`[vision] slab #${box.index} extraction failed:`, e?.message ?? e);
      // Return a placeholder so the slab still shows up for manual entry
      const fallback: ExtractedSlab = {
        index: box.index,
        crop_box: box.crop_box,
        grading_service: "UNKNOWN",
        cert_number: null,
        year: null,
        mint_mark: null,
        denomination: null,
        variety: null,
        grade_label: null,
        grade_numeric: null,
        designation: null,
        pcgs_number: null,
        has_cac_sticker: false,
        handwritten_ask_price: null,
        label_confidence: 0,
        notes: `Extraction failed: ${e?.message ?? e}`,
      };
      return fallback;
    }
  });

  // Renumber by detector order just in case
  slabs.sort((a, b) => a.index - b.index);
  slabs.forEach((s, i) => (s.index = i + 1));

  console.log(`[vision] extracted ${slabs.length} slab(s)`);

  return {
    slabs,
    global_notes,
    total_slabs_detected: slabs.length,
  };
}

// ---------- Helpers ----------

function clampBox(
  b: [number, number, number, number] | number[] | undefined,
): [number, number, number, number] {
  if (!Array.isArray(b) || b.length !== 4) return [0, 0, 1, 1];
  const [x, y, w, h] = b.map((n) => Math.max(0, Math.min(1, Number(n) || 0))) as [
    number,
    number,
    number,
    number,
  ];
  const ww = Math.min(w, 1 - x);
  const hh = Math.min(h, 1 - y);
  return [x, y, Math.max(0.01, ww), Math.max(0.01, hh)];
}

function splitDataUrl(dataUrl: string): {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  base64: string;
} {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("splitDataUrl: not a base64 data URL");
  const mediaType = m[1] as any;
  return { mediaType, base64: m[2] };
}

function bufferFromDataUrl(dataUrl: string): Buffer {
  const { base64 } = splitDataUrl(dataUrl);
  return Buffer.from(base64, "base64");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
