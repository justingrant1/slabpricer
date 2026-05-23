/**
 * Centralized, typed access to env vars.
 * Throws at first use if something required is missing, so failures happen
 * loud and early instead of silently producing "undefined" requests.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  // OpenAI
  get OPENAI_API_KEY() {
    return required("OPENAI_API_KEY");
  },
  OPENAI_VISION_MODEL: optional("OPENAI_VISION_MODEL", "gpt-4o"),

  // CDN
  CDN_BASE_URL: optional("CDN_BASE_URL", "https://cpgpublicapiv2beta.greysheet.com"),
  get CDN_API_KEY() {
    return required("CDN_API_KEY");
  },
  get CDN_API_TOKEN() {
    return required("CDN_API_TOKEN");
  },

  // PCGS Public API
  PCGS_API_BASE_URL: optional("PCGS_API_BASE_URL", "https://api.pcgs.com/publicapi"),
  get PCGS_API_TOKEN() {
    return required("PCGS_API_TOKEN");
  },

  // Airtable
  get AIRTABLE_TOKEN() {
    return required("AIRTABLE_TOKEN");
  },
  get AIRTABLE_BASE_ID() {
    return required("AIRTABLE_BASE_ID");
  },
  AIRTABLE_SCANS_TABLE: optional("AIRTABLE_SCANS_TABLE", "Scans"),
  AIRTABLE_SLABS_TABLE: optional("AIRTABLE_SLABS_TABLE", "Slabs"),

  // App auth
  get APP_PASSWORD() {
    return required("APP_PASSWORD");
  },
  get SESSION_SECRET() {
    return required("SESSION_SECRET");
  },
};

/** Returns true only if every variable needed for the CDN call is wired up. */
export function hasCdnCreds(): boolean {
  return Boolean(process.env.CDN_API_KEY && process.env.CDN_API_TOKEN);
}

/** True if Airtable is configured (token + base). */
export function hasAirtableCreds(): boolean {
  return Boolean(process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE_ID);
}

/** True if OpenAI is configured. */
export function hasOpenAiCreds(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
