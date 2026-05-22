/**
 * OpenAI GPT-4o vision extractor.
 *
 * Takes a single dealer photo (a tray of slabs, often with a handwritten
 * asking-price sticker) and returns a structured JSON array describing
 * each slab.
 *
 * We use response_format: json_schema (Structured Outputs) so the model is
 * forced to return data matching our schema exactly.
 */

import OpenAI from "openai";
import { env } from "@/lib/env";

// ---------- Output shape ----------

export type GradingService = "PCGS" | "NGC" | "ANACS" | "ICG" | "CAC" | "UNKNOWN";

export interface ExtractedSlab {
  /** Sequential index in the photo (1, 2, 3...) used as a stable id pre-commit. */
  index: number;
  grading_service: GradingService;
  /** Cert / serial number printed on the slab, digits only. */
  cert_number: string | null;
  /** Year printed on the coin, as a string (handles things like "1881"). */
  year: string | null;
  /** Mint mark (S, D, O, CC, P, etc.) — single char or empty. */
  mint_mark: string | null;
  /** Denomination + series, e.g. "Morgan Dollar", "Walking Liberty Half". */
  denomination: string | null;
  /** Variety / VAM / FS attribution if visible, else null. */
  variety: string | null;
  /** Grade label as printed: "MS65", "PR67", "AU58", "Genuine", etc. */
  grade_label: string | null;
  /** Numeric grade extracted from the label (1–70). null for ungraded/details. */
  grade_numeric: number | null;
  /** Strike/eye designation: "DCAM", "CAM", "FB", "FBL", "FH", "PL", "DMPL", "CAC", etc. */
  designation: string | null;
  /** PCGS coin number printed on the label (NOT the cert number). */
  pcgs_number: string | null;
  /** Has a green/gold CAC sticker on the slab? */
  has_cac_sticker: boolean;
  /**
   * Handwritten asking-price sticker on/near this slab.
   * Number only (USD), null if absent.
   */
  handwritten_ask_price: number | null;
  /**
   * Tight bounding box around the slab in the source image as
   * percentages of width/height (0..1). Used to crop a thumbnail.
   * [x, y, w, h]
   */
  crop_box: [number, number, number, number];
  /** Model self-reported confidence in the overall extraction (0..1). */
  label_confidence: number;
  /** Anything else readable on the label (free-form). */
  notes: string | null;
}

export interface VisionResult {
  slabs: ExtractedSlab[];
  /** Any general handwritten text on the photo that wasn't tied to a single slab. */
  global_notes: string | null;
  /** Number of slabs the model thinks are present. */
  total_slabs_detected: number;
}

// ---------- JSON schema (OpenAI Structured Outputs format) ----------

const slabSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "index",
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
    "crop_box",
    "label_confidence",
    "notes",
  ],
  properties: {
    index: { type: "integer" },
    grading_service: {
      type: "string",
      enum: ["PCGS", "NGC", "ANACS", "ICG", "CAC", "UNKNOWN"],
    },
    cert_number: { type: ["string", "null"] },
    year: { type: ["string", "null"] },
    mint_mark: { type: ["string", "null"] },
    denomination: { type: ["string", "null"] },
    variety: { type: ["string", "null"] },
    grade_label: { type: ["string", "null"] },
    grade_numeric: { type: ["integer", "null"] },
    designation: { type: ["string", "null"] },
    pcgs_number: { type: ["string", "null"] },
    has_cac_sticker: { type: "boolean" },
    handwritten_ask_price: { type: ["number", "null"] },
    crop_box: {
      type: "array",
      items: { type: "number" },
      minItems: 4,
      maxItems: 4,
    },
    label_confidence: { type: "number" },
    notes: { type: ["string", "null"] },
  },
} as const;

const responseSchema = {
  name: "slab_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["slabs", "global_notes", "total_slabs_detected"],
    properties: {
      slabs: { type: "array", items: slabSchema },
      global_notes: { type: ["string", "null"] },
      total_slabs_detected: { type: "integer" },
    },
  },
} as const;

// ---------- Prompt ----------

const SYSTEM_PROMPT = `You are an expert numismatist's assistant. You look at photos of \
graded coin slabs (PCGS, NGC, ANACS, ICG holders) — often photographed in a tray of \
several slabs at once, sometimes with a hand-written asking price sticker attached \
to or near a slab.

For EACH slab visible in the photo, extract the printed label information AND any \
handwritten asking price that clearly belongs to that specific slab.

Rules:
- "cert_number" is the long serial/certification number, digits only, no service \
  prefix. It is NOT the PCGS coin number (which is shorter, usually 4–6 digits and \
  identifies the coin type).
- "pcgs_number" is the short coin-type number (e.g. "7160" for an 1881-S Morgan). \
  If it's not visible on the label, return null.
- "grade_numeric" must be the Sheldon-scale integer (1–70). For details/genuine/\
  ungradeable coins return null and put the descriptor in grade_label.
- "designation" includes things like DCAM, CAM, FB, FBL, FH, PL, DMPL, etc. \
  Do NOT put CAC here — instead set has_cac_sticker = true.
- "handwritten_ask_price" is a USD number. Read carefully: handwritten "1.85" on \
  a coin sticker almost always means $185, not $1.85. Use context — if the coin \
  is a Morgan dollar in MS-65 the ask is most likely $100–$1000. Only fill this \
  in if a sticker price is clearly associated with this specific slab.
- "crop_box" is [x, y, width, height] as fractions of the full image (0..1), \
  tight around just this slab. Be accurate; this is used to crop a thumbnail.
- Order slabs by reading order: top-to-bottom, left-to-right.
- If you can't read a field with confidence, return null rather than guessing.
- "label_confidence" is YOUR confidence (0..1) that the slab's identifying info \
  (year, denomination, grade) is correct.`;

// ---------- Client ----------

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _client;
}

/**
 * Extract slabs from a single image.
 * @param imageDataUrl  data URL ("data:image/jpeg;base64,...") OR a public https URL.
 */
export async function extractSlabsFromImage(imageDataUrl: string): Promise<VisionResult> {
  const resp = await client().chat.completions.create({
    model: env.OPENAI_VISION_MODEL,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: responseSchema,
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract every slab visible in this dealer photo. Include any handwritten asking prices attached to each slab.",
          },
          {
            type: "image_url",
            image_url: { url: imageDataUrl, detail: "high" },
          },
        ],
      },
    ],
  });

  const raw = resp.choices[0]?.message?.content;
  if (!raw) throw new Error("Vision: empty response from OpenAI");

  let parsed: VisionResult;
  try {
    parsed = JSON.parse(raw) as VisionResult;
  } catch (e) {
    throw new Error(`Vision: model returned non-JSON: ${raw.slice(0, 300)}`);
  }

  // Defensive normalisation
  parsed.slabs = (parsed.slabs ?? []).map((s, i) => ({
    ...s,
    index: typeof s.index === "number" ? s.index : i + 1,
    crop_box: clampBox(s.crop_box),
  }));
  parsed.total_slabs_detected = parsed.slabs.length;
  return parsed;
}

function clampBox(b: [number, number, number, number] | undefined): [number, number, number, number] {
  if (!Array.isArray(b) || b.length !== 4) return [0, 0, 1, 1];
  const [x, y, w, h] = b.map((n) => Math.max(0, Math.min(1, Number(n) || 0))) as [number, number, number, number];
  // ensure box stays within image
  const ww = Math.min(w, 1 - x);
  const hh = Math.min(h, 1 - y);
  return [x, y, Math.max(0.01, ww), Math.max(0.01, hh)];
}
