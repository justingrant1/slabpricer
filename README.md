# Ben App — dealer-photo + slab-in-hand → CDN pricing

Ben gets a steady stream of group photos from other dealers — boards full of
graded slabs (PCGS / NGC / ANACS / CAC) plus the occasional handwritten ask
price. He also walks shows / shop visits where slabs come across the counter
one at a time. Today he types every coin into a spreadsheet, looks up bid/ask
on [CDN Exchange / Greysheet](https://www.greysheet.com), and decides whether
to buy.

This app collapses both flows to a few seconds.

**Flow A — Dealer photo (bulk):**

1. **Upload** the dealer photo (drag/drop, paste from clipboard, or the
   phone-camera button).
2. **GPT‑4o vision** detects every slab, reads year / mint / denomination /
   service / grade / cert # / variety / CAC sticker / handwritten ask.
3. **CDN Exchange API v2** is queried per slab for bid (Greysheet) and ask
   (CPG), plus PCGS / NGC / Blue Book.
4. Ben gets one **editable review table** — he tweaks anything wrong,
   optionally pastes a GSID, sets Buy/Pass/Negotiate, then **Commit to
   Airtable**.

**Flow B — Slab in hand (single coin):**

1. From the home page, switch to the **Slab in hand** tab.
2. Either **scan the barcode** on the back of the slab with the device
   camera (works for PCGS and NGC; uses native `BarcodeDetector` with a
   `@zxing/browser` fallback) **or type the cert number** + select service.
3. The app calls the **PCGS Public API** (`/coindetail/GetCoinFactsByCertNo`
   or `/coindetail/GetCoinFactsByBarcode`), which returns PCGS#, grade,
   designation, etc. — even for NGC slabs.
4. We synthesize a 1-row "scan" from that payload, run it through the same
   CDN pricing path, and drop Ben on the same review/commit page.

Stack:

- Next.js 14 (App Router) on Vercel
- OpenAI `gpt-4o` (vision) with structured JSON output
- `sharp` for in-process slab cropping
- CDN Exchange API v2 (typed wrapper in `lib/cdn.ts`)
- PCGS Public API v3 (typed wrapper in `lib/pcgs.ts`)
- `@zxing/browser` + native `BarcodeDetector` for in-browser slab scanning
- Airtable as the persistent store + Ben's data UI
- Single-password auth (Ben is the only user) via signed cookie

---

## Quick start

### 0. Prerequisites

- Node 20+
- pnpm (or npm — adjust commands below)
- A CDN Exchange API key + token (see `cpg-api-v2-documentation.md`)
- An OpenAI API key with `gpt-4o` access
- An Airtable personal access token + base (see
  [`scripts/provision-airtable.md`](scripts/provision-airtable.md))

### 1. Install

```bash
pnpm install
```

### 2. Environment

Copy `.env.example` to `.env.local` and fill in:

```ini
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_VISION_MODEL=gpt-4o

# CDN Exchange
CDN_BASE_URL=https://cpgpublicapiv2beta.greysheet.com
CDN_API_KEY=...
CDN_API_TOKEN=...

# Airtable
AIRTABLE_TOKEN=pat...
AIRTABLE_BASE_ID=app...
AIRTABLE_SCANS_TABLE=Scans
AIRTABLE_SLABS_TABLE=Slabs

# App auth
APP_PASSWORD=pick-a-long-one
SESSION_SECRET=64-random-bytes-hex
```

### 3. Provision Airtable

Follow [`scripts/provision-airtable.md`](scripts/provision-airtable.md). The
field names are case-sensitive and must match exactly.

### 4. Smoke-test the CDN connection

Useful as soon as you have your CDN keys (don't need anything else):

```bash
pnpm tsx scripts/cdn-smoke.ts          # 1881-S Morgan MS65 by default
pnpm tsx scripts/cdn-smoke.ts 7160 65  # any PCGS# + grade
```

### 5. Run

```bash
pnpm dev
# → http://localhost:3000
```

Log in with `APP_PASSWORD`, drag a dealer photo onto the upload card,
review, commit.

---

## Project layout

```
app/
  page.tsx                  # upload page (camera/paste/drop)
  UploadCard.tsx
  scan/[id]/page.tsx        # review screen wrapper
  scan/[id]/ReviewClient.tsx# the big editable table
  history/page.tsx          # list of past Airtable scans
  login/                    # password gate
  api/
    login/                  # set/clear session cookie
    scan/                   # POST → run vision + CDN
    scan/[id]/              # GET / source / thumb / row PATCH / commit
lib/
  env.ts                    # typed env vars + presence checks
  cdn.ts                    # typed wrapper around CDN Exchange API v2
  vision.ts                 # GPT-4o slab extractor (structured output)
  imageCrop.ts              # sharp-based per-slab thumbnails
  lookup.ts                 # orchestrates vision → CDN
  scanStore.ts              # in-memory session store (review screen)
  airtable.ts               # commit + history
  auth.ts                   # HMAC-signed session cookie
middleware.ts               # password gate everywhere except /login + /api/login
scripts/
  provision-airtable.md     # schema + Airtable MCP prompt
  cdn-smoke.ts              # end-to-end CDN test
```

---

## How it handles ambiguity

Vision models are great but not perfect on glare-y slab photos, and the CDN
API needs a specific (GsId | PcgsNumber) + Grade pair. So the review screen is
designed around **every field being editable** and a one-click **Re-price**
button that re-queries CDN with the user's corrections.

Per-slab outcomes:

- **Priced** — got real bid/ask, spread shown vs. handwritten ask.
- **No pricing** — CDN found the coin but had no data for that grade.
- **Map manually** — no PCGS# detected (e.g. damaged label, third-party
  service). Ben pastes a GSID from greysheet.com, hits Re-price.
- **Error / no-credentials** — surfaced inline.

Decisions auto-suggest **Buy** when their ask ≤ CDN bid, **Pass** when their
ask is > 20% above bid; everything else stays **Pending**. Ben can override.

---

## Deploy to Vercel

```bash
vercel link
vercel env pull .env.local        # if you've already added vars in the dashboard
vercel --prod
```

In the Vercel project settings, add every variable from `.env.example` to
Production. Set the `OPENAI_API_KEY` / `CDN_API_KEY` / `CDN_API_TOKEN` /
`AIRTABLE_TOKEN` / `SESSION_SECRET` as **secret**. Function timeout: the vision
+ CDN round-trip can take ~15-25s for a busy board; the upload route declares
`maxDuration = 60`.

---

## Roadmap

- [ ] Raw-coin (non-slab) mode for ungraded lots
- [ ] Auto-Sniper: webhook on incoming MMS/email, run the pipeline headlessly,
      drop the result in Ben's Telegram with a "buy now" button
- [ ] CDN “matching candidates” search for coins where PCGS# is illegible
- [ ] Cost log: track OpenAI spend per scan, surface in `/history`
