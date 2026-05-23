# Slab Pricer — Technical Overview

**Audience:** CEO, CTO, Senior Engineer
**Repo:** `github.com/justingrant1/slabpricer`
**Production:** Vercel (auto-deploys `main`)
**Status:** Functional end-to-end; in active use with one operator (Ben).

---

## 1. Problem & Goal

Ben (operations) receives daily offers from other dealers in two forms:

1. **Dealer tray photos** — a single photograph showing 1–20+ graded coin slabs
   (PCGS / NGC / ANACS / ICG holders), often with small handwritten
   asking-price stickers placed on each slab.
2. **Single slabs in hand** — physical slabs in our office that need to be
   priced before we make an offer.

For every slab, Ben needs:

- The full identification (year, mint mark, denomination, variety,
  grading service, grade, special designation, CAC sticker presence).
- The **CDN (Greysheet) bid / ask** for that exact coin + grade — the
  industry-standard wholesale price reference.
- A clear visual indicator of whether the dealer's asking price is above
  or below CDN bid (i.e. is this a buy?).
- A persistent record in Airtable for downstream workflows
  (purchasing, inventory, accounting).

Previously this was 100% manual: zoom into each slab, type the data into
a Greysheet lookup form, transcribe bid/ask back into a spreadsheet,
repeat 10–30 times per photo. The new app collapses that to a single
photo upload + one review screen.

---

## 2. Solution Summary

A single-tenant Next.js 14 web app, deployed on Vercel, that:

1. Accepts a dealer photo or a single-slab capture (web + mobile, with
   camera, drag-drop, paste, and barcode-scanner inputs).
2. Runs a two-pass **Claude (Anthropic) vision pipeline** to detect and
   read every slab on the image.
3. Resolves each slab against the **CDN Exchange v2 API** to fetch bid /
   ask for the exact PCGS coin number + grade, with a CAC adjustment.
4. Optionally cross-references the **PCGS Public API** when scanning a
   slab barcode / cert number directly.
5. Presents the results in an editable review table with spread (ask –
   bid) coloring and a "commit all to Airtable" action.
6. Stores every committed scan + slab in Airtable for history and
   reporting.

---

## 3. Architecture

### 3.1 Stack

| Layer | Choice | Why |
|------|--------|----|
| Framework | **Next.js 14 (App Router)** | One repo for UI + API; server components for data fetching; native Vercel deploy. |
| Runtime | **Node.js** serverless functions | Need `sharp` for image processing — won't run on Edge. |
| Language | **TypeScript** end-to-end | Tight types across API boundaries (CDN, PCGS, vision, Airtable). |
| Styling | **Tailwind CSS** + a few hand-rolled tokens | Minimal CSS; consistent dense data UI. |
| Vision | **Anthropic Claude Sonnet 4.6** (`claude-sonnet-4-6`) with tool-use | Best multi-image OCR + structured output we tested. |
| Pricing API | **CDN Exchange v2** (Greysheet) | Authoritative wholesale price source. |
| Cert API | **PCGS Public API** | Slab cert # → PCGS coin number resolution. |
| Persistence | **Airtable** | Ben already lives in Airtable; zero-code reporting. |
| Hot state | **Vercel KV** (Upstash Redis) with in-memory fallback | Per-scan session lives 24h; survives lambda hops. |
| Image ops | **sharp** | Resize, crop, re-encode (per-slab and detector-pass images). |
| Auth | Single shared password + signed HMAC cookie | Internal tool, one user. |

### 3.2 Data flow

```
                 ┌──────────────────┐
  Browser ──────►│  /api/scan       │
   (FormData,    │  multipart upload │
    JPEG ≤4MB)   └────────┬─────────┘
                          │
                 ┌─────────▼──────────┐
                 │  sharp resize       │  → 2048px detector image (data URL)
                 │  + full-res Buffer  │
                 └─────────┬──────────┘

                          │
                ┌─────────▼──────────┐
   Anthropic ◄──┤ Pass 1: detector   │ ── tool_use(report_slabs) ─► boxes[]
                └─────────┬──────────┘
                          │ per box
                ┌─────────▼──────────┐
                │ sharp crop full-res │  → 1280px / q92 slab JPEG
                └─────────┬──────────┘
                          │  (concurrency 4)
                ┌─────────▼──────────┐
   Anthropic ◄──┤ Pass 2: per slab   │ ── tool_use(report_slab_fields) ─► fields
                └─────────┬──────────┘
                          │
                ┌─────────▼──────────┐
   CDN API ◄────┤ priceAll (parallel)│ ── GetPricingRequest(PcgsNumber,Grade)
                └─────────┬──────────┘
                          │
                ┌─────────▼──────────┐
                │ scanStore.put (KV) │  scan_id → {vision, rows, source image}
                └─────────┬──────────┘
                          │
              redirect → /scan/[id]
                          │
                ┌─────────▼──────────┐
                │ ReviewClient.tsx   │ editable table, /api/lookup on edit
                └─────────┬──────────┘
                          │ Commit all →
                ┌─────────▼──────────┐
  Airtable ◄────┤ /api/scan/[id]/    │  creates Scans row + 1 Slabs row each
                │  commit            │
                └────────────────────┘
```

### 3.3 Module map

```
app/
  layout.tsx                  global shell + nav
  page.tsx                    home (tab switcher)
  HomeTabs.tsx                "Dealer photo" / "Slab in hand"
  UploadCard.tsx              dealer photo intake + client-side compression
  SlabInHandCard.tsx          single-slab capture + barcode scanner
  scan/[id]/page.tsx          server-side load of scan session
  scan/[id]/ReviewClient.tsx  editable table, re-lookup, commit
  history/page.tsx            list of committed scans (from Airtable)
  login/...                   shared-password gate
  api/
    login/route.ts            sets signed session cookie
    scan/route.ts             POST: vision → pricing → store
    scan/[id]/route.ts        GET: hydrate the review page
    scan/[id]/source/route.ts GET: serve original photo
    scan/[id]/thumb/[index]/route.ts  per-slab cropped JPEG
    scan/[id]/rows/[index]/route.ts   PATCH: edit one row
    scan/[id]/commit/route.ts POST: write to Airtable
    lookup/route.ts           cert# / PCGS# → CDN single-slab lookup

lib/
  env.ts          typed env access (throws on first use if missing)
  vision.ts       Claude two-pass pipeline (the core of the app)
  imageCrop.ts    sharp helpers (resize / crop / re-encode)
  cdn.ts          typed CDN v2 client
  cdnCatalog.ts   catalog-walk Gsid resolver (fallback when no PCGS#)
  pcgs.ts         typed PCGS public API client
  lookup.ts       orchestrate vision row → CDN price (PCGS# → catalog walk)
  airtable.ts     Scans + Slabs writers (read-modify-write)
  scanStore.ts    KV-backed session store with mem fallback
  auth.ts         HMAC-signed cookie session

data/
  cdn-node-map.json   hand-curated denomination → CDN node id map

scripts/
  cdn-build-node-map.ts  crawler to regenerate the node map
  cdn-smoke.ts           live CDN sanity check
  provision-airtable.md  Airtable base provisioning notes

middleware.ts     auth gate for everything except /login + /api/login
```


---

## 4. The Vision Pipeline (the hard part)

This is where the most engineering effort and iteration went. The first
implementation used a single GPT-4o call asking it to find AND read
every slab in the image. It worked great for 1–2 slabs and degraded
sharply past 4 — Claude or GPT would either miss slabs entirely, merge
two slabs, or hallucinate fields.

**Current implementation (`lib/vision.ts`) — two-pass Claude Sonnet 4.6:**

### Pass 1 — Detector
- Single API call with the **whole-tray photo** downsized to **2048px**
  on the long edge. (Bumped from 1600px in March '26 — the older
  resolution was the dominant cause of the detector merging two
  adjacent slabs into one box on dense 10+ slab trays.)
- Strict tool-use: a `report_slabs` tool whose JSON schema requires
  a `slab_count` integer **plus** an array of
  `{index, crop_box: [x, y, w, h], label_confidence}` and an optional
  `global_notes`. The schema is deliberately count-first: the system
  prompt forces Claude to count every slab and set `slab_count` before
  emitting boxes, with explicit "do not merge adjacent slabs" and
  "sweep every row" rules. Empirically this is the single biggest
  reliability win at high slab counts — without the count commitment,
  the model will silently stop listing boxes one row short.
- If the returned `slab_count` doesn't equal the number of boxes
  actually returned, we prepend a `⚠️ Detector reported N but only
  returned M…` warning to `global_notes` so Ben sees a "check the
  source image" nudge in the review UI. `boxes.length` remains
  authoritative for downstream.
- Crop boxes are 0..1 fractions of the original image; we re-number
  the indices server-side to guarantee a clean 1..N reading order.
- Tiny boxes (<2% of image) are dropped as noise.


### Pass 2 — Per-slab extractor
- For each detected box, **sharp** crops the **original full-resolution
  buffer** with ~5% padding around the box and re-encodes at 1280px /
  JPEG q92.
- Each crop is sent to Claude in its own API call with a system prompt
  asserting "exactly ONE slab in this image; the asking-price sticker
  on it belongs to THIS slab." This gives Claude the full vision
  budget for each label and dramatically improves accuracy on small
  details (PCGS coin #, cert #, handwritten prices).
- Strict tool-use again: `report_slab_fields` returns
  `{grading_service, cert_number, year, mint_mark, denomination,
   variety, grade_label, grade_numeric, designation, pcgs_number,
   has_cac_sticker, handwritten_ask_price, label_confidence, notes}`.
- Calls are issued with **bounded concurrency (4)** to avoid Anthropic
  rate limits while keeping wall time low.
- A failing slab does NOT fail the whole scan — it returns a
  placeholder row that Ben can fill in manually.

### Prompt engineering notes
- Both passes use Anthropic **tool-use with explicit input schemas**.
  This is the single biggest reliability win; free-text JSON output is
  consistently 5–10% malformed at our volumes.
- The per-slab prompt has an explicit instruction about handwritten
  prices: "`1.85` on a Morgan dollar sticker almost always means $185,
  not $1.85" — coin context disambiguates magnitudes the model would
  otherwise get wrong.
- Grade is split into `grade_label` (string, supports
  Details/Genuine) and `grade_numeric` (1–70 integer or null). CDN's
  pricing endpoint requires the integer.

### Model selection
- Default: `ANTHROPIC_VISION_MODEL=claude-sonnet-4-6`.
- The older `claude-3-5-sonnet-20241022` snapshot was retired by
  Anthropic mid-development; the dateless 4.6 ID is a pinned snapshot,
  not an evergreen alias.

---

## 5. CDN Pricing Integration

`lib/cdn.ts` is a typed client over `cpgpublicapiv2beta.greysheet.com`.

- **Auth:** two custom headers (`X-ApiKey`, `X-Token`).
- **Primary endpoint:** `POST /GetPricingRequest` with body
  `{PcgsNumber, Grade, Advanced: true}` or `{Gsid, Grade, Advanced: true}`.
- Response is a Greysheet `Data[]` array. `summarisePricing()`
  collapses the response into a typed `SlabPricingSummary` with
  `{bid, ask, cdnBid, cdnAsk, cacBid, cacAsk, lastUpdated, link,
  approximateGrade, requestedGrade, gradeLabel, ...}`, preferring CAC
  pricing when the slab has a CAC sticker (we read this from the
  vision pass).
- All slabs are priced in parallel after the vision pass returns.

`scripts/cdn-smoke.ts` is a CLI sanity check against the live CDN API.

### 5.1 Resolution chain (`lib/lookup.ts`)

A surprising number of dealer-photo slabs — especially NGC, ANACS, and
ICG holders — do **not** print a PCGS coin number on the label. CDN's
pricing endpoint can take either a PCGS# or a Greysheet `Gsid`, so we
chain strategies in order until one yields a price:

1. **PCGS# lookup** — if the vision pass returned a `pcgs_number`,
   hit `GetPricingRequest` keyed by `PcgsNumber + Grade`. If the exact
   grade has no row, retry once with a ±2 grade window and let
   `summarisePricing` pick the nearest published grade (flagged as
   `approximateGrade = true` so the UI can warn Ben).
2. **Catalog walk** (`lib/cdnCatalog.ts`) — if there's no PCGS# or it
   didn't match, map the vision's `denomination` (free text like
   "Morgan Dollar" or "1c") to a CDN parent node id via a curated
   `data/cdn-node-map.json`. Then `GetCollectibleByNodeRequest` lists
   every collectible under that series and we score each candidate on
   `year`, `MintMark`, `Variety`, and `Designation` to pick a `Gsid`.
   The match has to clear a minimum score (year match required) or we
   give up to avoid false positives.
3. **Manual override** — if neither path produced a `Gsid`, the row is
   marked `needs-mapping` and the review UI exposes a 🔍 button that
   opens a pre-filled `greysheet.com/search?q=…` in a new tab. Ben
   pastes the Gsid back into a small input and the row re-prices.

Each priced row carries a `resolvedVia` flag (`"pcgs"`,
`"catalog-walk"`, or `"manual-gsid"`) so the UI can show how the
match was made, and `spreadDollars / spreadPercent` are computed
relative to the dealer's handwritten asking price.

### 5.2 The node map

`data/cdn-node-map.json` is a hand-curated seed covering ~22 of the
most common U.S. series Ben sees: Lincoln (wheat / memorial / shield)
cents, Indian-head cents, Buffalo / Jefferson nickels, Mercury /
Roosevelt dimes, Washington quarters, Walking Liberty / Franklin /
Kennedy halves, Morgan / Peace / Eisenhower dollars, $1–$20 classic
gold, and American Silver / Gold Eagles.

Each entry is:

```jsonc
{
  "series": "Morgan Dollar",
  "aliases": ["$1", "morgan dollar", "morgan", "silver dollar morgan"],
  "nodeId": 36,
  "yearMin": 1878,
  "yearMax": 1921
}
```

Aliases are matched case- and punctuation-insensitively against the
free-text `denomination` the vision pass emits. `yearMin`/`yearMax`
disambiguate cases where two series share a denomination (Indian-head
cents vs. wheat cents vs. memorial cents).

If CDN reorganizes its catalog,
`pnpm tsx scripts/cdn-build-node-map.ts > data/cdn-node-map.json`
re-walks the U.S. coins root and regenerates the file; you then
re-annotate `aliases` and year windows by hand.

### 5.3 Failure modes (deliberately distinct statuses)
- `priced` — got real numbers.
- `no-pricing` — CDN found the coin but has no row even after a ±2
  grade widening.
- `needs-mapping` — neither PCGS# nor catalog walk produced a `Gsid`;
  Ben must paste one from the Greysheet quick-search.
- `no-credentials` — env not configured (used during onboarding).
- `error` — network or API failure; original error message surfaced.


---

## 6. PCGS Cert Lookup (for the Slab-in-Hand flow)

`lib/pcgs.ts` wraps `api.pcgs.com/publicapi`. The single-slab capture
screen lets Ben:

- Type / paste a cert #.
- Use the device camera as a **live barcode scanner** (Code 128 /
  Data Matrix on PCGS slab edges) via a lightweight JS scanner inside
  `SlabInHandCard.tsx`.

Given a cert number, `/api/lookup`:

1. Calls PCGS' `GetCoinFactsByCertNumber` to resolve the cert → PCGS
   coin number + grade.
2. Hands that off to the same `priceSlab()` orchestrator the dealer-
   photo flow uses, so the pricing logic and UI are unified.

---

## 7. Storage & Persistence

### 7.1 Hot session store — `lib/scanStore.ts`
- Backed by **Vercel KV** (Upstash Redis) when `KV_REST_API_URL` /
  `KV_REST_API_TOKEN` are present.
- Falls back to a process-local `Map` for `next dev`.
- **Why this exists:** Vercel serverless functions are stateless and
  not sticky. The first naive implementation kept scans in a Node
  `Map`, which worked locally but caused `/scan/[id]` to 404 in prod
  because the upload lambda and the review-page lambda are different
  processes.
- Sessions live 24h. Stored payload: the resized source image
  (data URL), the full `VisionResult`, the priced `rows[]`, and any
  edits Ben has made.

### 7.2 Durable store — Airtable (`lib/airtable.ts`)
Base: `appN1l2nIG2sFS6ZN`, provisioned via the Airtable MCP server
during build (see `scripts/provision-airtable.md`).

Two tables:

- **Scans** — one row per committed scan
  - `Scan ID`, `Source` (dealer name), `Created`, `Slab Count`,
    `Total Ask`, `Total Bid`, `Total Spread`, `Source Image`
    (attachment).
- **Slabs** — one row per committed slab, linked to Scans
  - All identification fields, `Grade`, `Designation`, `Has CAC`,
    `Asking Price`, `CDN Bid`, `CDN Ask`, `Spread $`, `Spread %`,
    `Status`, `Notes`, `Thumbnail`, `Greysheet Link`.

`/api/scan/[id]/commit` writes the Scans row first, then bulk-creates
Slabs rows with a linked record back to the scan. All edits Ben made
in the review UI flow through into Airtable.

History page (`/history`) reads directly from the Scans table.

---

## 8. Frontend / UX Highlights

- **`UploadCard.tsx`** — drag-drop, file picker, mobile rear camera
  (`capture="environment"`), Cmd-V paste from clipboard.
  Performs **client-side compression** before upload (canvas
  re-encode to ≤3200px JPEG, retrying progressively lower quality
  if the result exceeds 4MB) to stay under Vercel's 4.5MB function-
  request body limit. Modern iPhone photos (8–15MB) routinely tripped
  this in production until compression was added.
- **`ReviewClient.tsx`** — a dense editable table with one row per
  slab and an inline crop thumbnail (served from
  `/api/scan/[id]/thumb/[index]`). Every editable field re-fires a
  `PATCH /api/scan/[id]/rows/[index]` which re-prices that row in
  isolation. Spread is rendered green/red. Each card also surfaces:
  - an **"≈ approximate — nearest published grade is X"** warning
    when CDN had no row for the exact grade and we fell back to the
    nearest one,
  - a **"Matched via CDN catalog walk"** subtitle when the Gsid
    fallback fired (vs. a direct PCGS# hit), and
  - a 🔍 button next to the manual GSID input that opens a pre-filled
    `greysheet.com/search?q=…` in a new tab so Ben can quickly find
    the right Gsid for `needs-mapping` rows.
  A "Commit all to Airtable" button finalises the scan.

- **`SlabInHandCard.tsx`** — barcode scanner + cert # entry, single
  result panel using the same row design as the bulk table.
- **`HomeTabs.tsx`** — tab switcher between the two intake modes.
- **Auth** — `middleware.ts` checks the signed cookie set by
  `/api/login`. Single shared password (`APP_PASSWORD`); HMAC-signed
  with `SESSION_SECRET`.

---

## 9. Operational Concerns

### 9.1 Environment variables
Documented in `.env.example`. The required ones:

```
ANTHROPIC_API_KEY              # vision (primary)
ANTHROPIC_VISION_MODEL=claude-sonnet-4-6
CDN_API_KEY / CDN_API_TOKEN    # Greysheet
PCGS_API_TOKEN                 # cert lookups
AIRTABLE_TOKEN / AIRTABLE_BASE_ID
APP_PASSWORD                   # shared sign-in
SESSION_SECRET                 # 32+ chars
KV_REST_API_URL / KV_REST_API_TOKEN  # auto-injected by Vercel KV
```

OpenAI keys are still in `env.ts` as a legacy fallback path but are
no longer used by the active code path.

### 9.2 Deploy
- `main` → Vercel production via the GitHub integration.
- `pnpm` is the package manager; lockfile is committed.
- Build is a vanilla `next build`; no custom scripts.

### 9.3 Cost & latency
- A single scan of an 8-slab tray performs:
  - 1 detector call (~6–10s).
  - 8 per-slab extractor calls in parallel, concurrency 4, ~3–6s each.
  - 8 CDN pricing calls in parallel, <1s each.
- Total wall time: typically 18–35s for a tray of 8–12 slabs.
- Anthropic token usage is dominated by image bytes. Each crop is
  1280px / q92, ≈ 200–350KB. Cost is well within the operator's
  manual-time savings.

### 9.4 Failure isolation
- Per-slab vision failures return placeholder rows, not 500s.
- CDN failures degrade gracefully into `needs-mapping` status with a
  human-readable error message.
- Vercel KV missing? In-memory fallback keeps `next dev` working.
- Anthropic model id missing/retired? Error surfaces in the
  `/api/scan` response and is rendered in the UI.

### 9.5 Security
- Single shared password is appropriate for the user count (1).
- Cookie is HMAC-signed; secret is required env.
- All API keys server-side only; never reach the browser.
- No third-party JS beyond the barcode scanner and Tailwind runtime.

---

## 10. What's Intentionally Out of Scope (For Now)

- **Multi-user / roles** — single tenant. Add NextAuth or Clerk if
  this needs to grow past one operator.
- **CDN bid pulling for ungraded raw coins** — out of pipeline.
- **NGC API** — NGC publishes a similar verification API but it's
  pay-walled; current accuracy on NGC slabs through the vision pass is
  acceptable.
- **HEIC server-side decode** — relies on the browser to render iOS
  HEIC into a `<img>` / `createImageBitmap` before our canvas
  re-encode. Safari, Chrome, and Edge all handle this; Firefox does
  not, so Firefox-on-iOS uploads of HEIC may fail. Not a real-world
  user.
- **Streaming the vision response** — we return one JSON blob at the
  end. Could be incremental with a websocket or SSE if Ben asks.

---

## 11. Open Questions / Future Work

1. **OCR caching by cert#.** Slabs are uniquely identified by service
   + cert. We could cache `(service, cert#) → fields` to skip vision
   on repeat photos of the same coin (auctions reshare images often).
2. **Confidence-driven review.** The vision pass already returns
   `label_confidence` — we could auto-commit rows above a threshold
   and surface only the uncertain ones for Ben's eyes.
3. **CDN bulk endpoint.** If the CDN team exposes a multi-coin pricing
   call, we can replace the per-slab fan-out and cut a few seconds.
4. **Direct integration into purchasing.** Airtable is a temporary
   landing zone; downstream we could push directly into our PO system
   when Ben hits "buy".
5. **Replace shared password with magic-link auth** if the user count
   grows beyond 2–3.

---

## 12. Repository Index

- `README.md` — setup + Vercel deploy instructions.
- `cpg-api-v2-documentation.md` — vendor docs for CDN, included so the
  client code can be re-derived if the upstream docs disappear.
- `pcgs-api-instructions.md` — vendor docs for the PCGS Public API.
- `data/cdn-node-map.json` — denomination → CDN node id map driving
  the catalog-walk fallback.
- `scripts/cdn-smoke.ts` — live CDN sanity check.
- `scripts/cdn-build-node-map.ts` — regenerate `cdn-node-map.json`
  by crawling CDN's U.S. coins tree.
- `scripts/provision-airtable.md` — how the Airtable base was
  provisioned (via MCP) plus a manual fallback.
- `TECHNICAL_OVERVIEW.md` — this document.

---

## 13. Changelog (recent notable changes)

- **Count-first detector + 2048px tray image** (`lib/vision.ts`,
  `lib/imageCrop.ts`). The Pass 1 detector now (a) sees the tray at
  2048px on the long edge instead of 1600px and (b) is forced to set a
  required `slab_count` integer in its tool call before listing boxes.
  Fixes a class of 10+ slab dealer photos where the model was
  silently merging adjacent slabs or stopping a row short. When the
  reported count and returned box count disagree, a "⚠️ Detector
  reported N but only returned M…" warning is prepended to
  `global_notes` so Ben sees a "check the source image" nudge in the
  review UI.
- **Catalog-walk Gsid fallback** (`lib/cdnCatalog.ts`,

  `data/cdn-node-map.json`). Dealer-photo slabs without a PCGS coin
  number on the label (most NGC / ANACS / ICG holders) now auto-
  resolve to a Greysheet Gsid by scoring candidates under a curated
  series node. Adds a `resolvedVia` flag on every priced row.
- **±2 grade-window retry in `lib/lookup.ts`.** If `GetPricingRequest`
  has no row at the exact grade, we retry once with a wider window
  and let `summarisePricing` pick the nearest published grade
  (surfaced in the UI as "≈ approximate").
- **Greysheet quick-search button** in `ReviewClient.tsx` for
  `needs-mapping` rows — opens a pre-filled `greysheet.com/search`
  in a new tab so Ben can copy the right Gsid back in.
- **Two-pass Claude Sonnet 4.6 vision pipeline** replacing the
  single-call GPT-4o approach (see §4).
- **Vercel KV scan store** with in-memory fallback so `/scan/[id]`
  survives the cross-lambda hop in production.
- **Client-side JPEG compression** in `UploadCard.tsx` to stay under
  Vercel's 4.5MB request-body cap.


