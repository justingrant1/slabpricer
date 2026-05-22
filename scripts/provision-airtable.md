# Airtable schema provisioning

We deliberately do **not** create tables/fields from the app — Airtable's
metadata API is rate-limited and it's far easier (and safer) to bootstrap the
schema once via the Airtable MCP server, then let the app just read/write rows.

## Option A — Use the Airtable MCP from Cline (recommended)

In Cline (Plan or Act mode), paste this prompt:

> Using the Airtable MCP server, in base `<AIRTABLE_BASE_ID>` create two tables
> with the exact field names below. After creating them, print the table IDs.

### Table 1: **Scans**

| Field          | Type                       | Notes                                  |
| -------------- | -------------------------- | -------------------------------------- |
| Name           | Single line text (primary) | autocomposed timestamp + dealer        |
| Photo          | Attachment                 | original dealer image                  |
| Scanned At     | Date (incl. time)          | ISO 8601                               |
| Source         | Single line text           | dealer / chat thread                   |
| Status         | Single select              | options: `New`, `Reviewed`, `Committed`|
| Slab Count     | Number (integer)           |                                        |
| Total Their Ask| Currency (USD)             |                                        |
| Total CDN Bid  | Currency (USD)             |                                        |
| Notes          | Long text                  |                                        |

### Table 2: **Slabs**

| Field             | Type                       | Notes                                       |
| ----------------- | -------------------------- | ------------------------------------------- |
| Name              | Single line text (primary) | e.g. "1881-S Morgan $1 MS65 (PCGS)"         |
| Scan              | Link to **Scans**          | one Scan → many Slabs                       |
| Thumbnail         | Attachment                 | per-slab crop                               |
| Grading Service   | Single select              | `PCGS`, `NGC`, `ANACS`, `ICG`, `CAC`, `UNKNOWN` |
| Cert #            | Single line text           |                                             |
| Year              | Single line text           | strings ("1879-CC" stays one field)         |
| Mint Mark         | Single line text           |                                             |
| Denomination      | Single line text           |                                             |
| Variety           | Single line text           |                                             |
| Grade             | Number (integer)           | 1-70                                        |
| Grade Label       | Single line text           | "MS65", "PR67", "Genuine"                   |
| Designation       | Single line text           | "DCAM", "FB", "PL"                          |
| CAC               | Checkbox                   |                                             |
| PCGS #            | Single line text           | catalog #                                   |
| GsId              | Number (integer)           | CDN id                                      |
| CDN Bid           | Currency                   |                                             |
| CDN Ask           | Currency                   |                                             |
| CPG Val           | Single line text           | raw CDN string (preserves "BID")            |
| PCGS Val          | Single line text           |                                             |
| NGC Val           | Single line text           |                                             |
| Blue Book Val     | Single line text           |                                             |
| Their Ask         | Currency                   | handwritten on the photo                    |
| Spread $          | Currency                   | Their Ask − CDN Bid                         |
| Spread %          | Percent                    |                                             |
| Decision          | Single select              | `Buy`, `Pass`, `Negotiate`, `Pending`       |
| Final Offer       | Currency                   |                                             |
| Looked Up At      | Date (incl. time)          |                                             |
| Status            | Single select              | `priced`, `no-pricing`, `needs-mapping`, `no-credentials`, `error` |
| Vision Confidence | Number (decimal, 2 places) | 0..1                                        |
| Notes             | Long text                  |                                             |

## Option B — Manual creation

Create the same tables in Airtable's UI. Names are **case-sensitive** and must
match `SCAN_FIELDS` / `SLAB_FIELDS` in `lib/airtable.ts` exactly.

## After provisioning

1. Copy the base ID (`appXXXXXXXXXXXXXX`) from the URL.
2. Create a personal access token at <https://airtable.com/create/tokens> with
   scopes `data.records:read`, `data.records:write`, and access to the base.
3. Put both in `.env.local`:

   ```
   AIRTABLE_TOKEN=patXXXXXXXXXXXXXX
   AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
   AIRTABLE_SCANS_TABLE=Scans
   AIRTABLE_SLABS_TABLE=Slabs
   ```

The first scan you commit will show up in the **Scans** view; clicking it will
reveal the linked rows in **Slabs**.
