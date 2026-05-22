"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ExtractedSlab, GradingService, VisionResult } from "@/lib/vision";
import type { PricedSlab } from "@/lib/lookup";

/**
 * The big editable review screen.
 *
 *   - One card per slab the vision model detected
 *   - Editable fields (every vision-extracted attribute is editable)
 *   - "Re-price" button that calls PATCH /api/scan/[id]/rows/[index] with the
 *     current edits and an optional manual GSID override
 *   - Buy/Pass/Negotiate decision + final-offer per row
 *   - Totals at the bottom + "Commit all to Airtable"
 */

type SlimScan = {
  id: string;
  createdAt: number;
  source?: string;
  sourceMimeType: string;
  sourceFilename: string;
  vision: VisionResult;
  rows: PricedSlab[];
};

type Decision = "Buy" | "Pass" | "Negotiate" | "Pending";

interface RowUi {
  /** Server-side priced row (what we'll commit). */
  priced: PricedSlab;
  /** Local pending edits not yet applied via re-price. */
  edits: Partial<ExtractedSlab>;
  /** Manual GSID override the user entered (empty = none). */
  gsidOverride: string;
  decision: Decision;
  finalOffer: string;
  notes: string;
  busy: boolean;
}

const SERVICES: GradingService[] = ["PCGS", "NGC", "ANACS", "ICG", "CAC", "UNKNOWN"];

function fmtMoney(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
function fmtPct(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = n * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

export default function ReviewClient({
  scanId,
  initial,
  sourceImgUrl,
}: {
  scanId: string;
  initial: SlimScan;
  sourceImgUrl: string;
}) {
  const router = useRouter();
  const [globalSource, setGlobalSource] = useState(initial.source ?? "");
  const [globalNotes, setGlobalNotes] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitErr, setCommitErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [rows, setRows] = useState<Record<number, RowUi>>(() => {
    const out: Record<number, RowUi> = {};
    for (const p of initial.rows) {
      out[p.slab.index] = {
        priced: p,
        edits: {},
        gsidOverride: "",
        decision: defaultDecision(p),
        finalOffer: p.slab.handwritten_ask_price != null ? String(p.slab.handwritten_ask_price) : "",
        notes: "",
        busy: false,
      };
    }
    return out;
  });

  const order = useMemo(
    () => initial.vision.slabs.map((s) => s.index).sort((a, b) => a - b),
    [initial.vision.slabs],
  );

  function patch(idx: number, p: Partial<RowUi>) {
    setRows((prev) => ({ ...prev, [idx]: { ...prev[idx], ...p } }));
  }
  function patchEdit(idx: number, e: Partial<ExtractedSlab>) {
    setRows((prev) => ({
      ...prev,
      [idx]: { ...prev[idx], edits: { ...prev[idx].edits, ...e } },
    }));
  }

  async function reprice(idx: number) {
    const r = rows[idx];
    if (!r) return;
    patch(idx, { busy: true });

    const merged: ExtractedSlab = { ...r.priced.slab, ...r.edits, index: idx };
    const gsid = r.gsidOverride.trim() ? Number(r.gsidOverride.trim()) : undefined;

    try {
      const res = await fetch(`/api/scan/${scanId}/rows/${idx}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slab: merged,
          overrideGsid: gsid && Number.isFinite(gsid) ? gsid : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      patch(idx, {
        priced: json.row,
        edits: {},
        busy: false,
        decision: defaultDecision(json.row),
      });
    } catch (e: any) {
      patch(idx, { busy: false });
      alert(`Re-price failed: ${e?.message ?? e}`);
    }
  }

  async function commitAll() {
    setCommitting(true);
    setCommitErr(null);
    const payload = {
      rows: order.map((idx) => {
        const r = rows[idx];
        const offer = r.finalOffer.trim() === "" ? null : Number(r.finalOffer);
        return {
          index: idx,
          decision: r.decision,
          finalOffer: Number.isFinite(offer as number) ? offer : null,
          notes: r.notes || undefined,
        };
      }),
      notes: globalNotes || undefined,
      source: globalSource || undefined,
    };
    try {
      const res = await fetch(`/api/scan/${scanId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      startTransition(() => router.push("/history?committed=1"));
    } catch (e: any) {
      setCommitErr(e?.message ?? "Commit failed");
      setCommitting(false);
    }
  }

  const totals = useMemo(() => {
    let bid = 0, ask = 0, theirAsk = 0, offer = 0, priced = 0;
    for (const idx of order) {
      const r = rows[idx];
      if (r.priced.pricing?.bid) bid += r.priced.pricing.bid;
      if (r.priced.pricing?.ask) ask += r.priced.pricing.ask;
      if (r.priced.slab.handwritten_ask_price) theirAsk += r.priced.slab.handwritten_ask_price;
      const o = Number(r.finalOffer);
      if (Number.isFinite(o)) offer += o;
      if (r.priced.status === "priced") priced++;
    }
    return { bid, ask, theirAsk, offer, priced };
  }, [rows, order]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Review Scan</h1>
          <p className="text-sm text-muted">
            {initial.vision.slabs.length} slab{initial.vision.slabs.length === 1 ? "" : "s"} detected ·{" "}
            {totals.priced} priced via CDN
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className="btn">← New Scan</Link>
          <button className="btn-primary" onClick={commitAll} disabled={committing}>
            {committing ? "Saving…" : "Commit all to Airtable"}
          </button>
        </div>
      </div>

      {/* Source preview + scan-level metadata */}
      <div className="card">
        <div className="flex flex-col md:flex-row gap-4">
          <img
            src={sourceImgUrl}
            alt="source"
            className="rounded-md object-contain max-h-[300px] md:max-w-[380px] bg-bg"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
            <Field label="Source / dealer">
              <input className="input" value={globalSource} onChange={(e) => setGlobalSource(e.target.value)} />
            </Field>
            <Field label="Filename">
              <input className="input" value={initial.sourceFilename} readOnly />
            </Field>
            <Field label="Scan notes" className="sm:col-span-2">
              <textarea
                className="textarea"
                rows={2}
                value={globalNotes}
                onChange={(e) => setGlobalNotes(e.target.value)}
                placeholder="e.g. lot from John, asking $X all-in"
              />
            </Field>
            {initial.vision.global_notes && (
              <div className="sm:col-span-2 text-xs text-muted">
                <strong>Vision notes:</strong> {initial.vision.global_notes}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Per-slab cards */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {order.map((idx) => (
          <SlabCard
            key={idx}
            idx={idx}
            row={rows[idx]}
            scanId={scanId}
            patch={(p) => patch(idx, p)}
            patchEdit={(e) => patchEdit(idx, e)}
            onReprice={() => reprice(idx)}
          />
        ))}
      </div>

      {/* Sticky totals + commit */}
      <div className="card sticky bottom-2 backdrop-blur bg-panel/95">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm text-muted flex flex-wrap gap-x-6 gap-y-1">
            <span>Their ask: <strong className="text-text">{fmtMoney(totals.theirAsk)}</strong></span>
            <span>CDN bid: <strong className="text-good">{fmtMoney(totals.bid)}</strong></span>
            <span>CDN ask: <strong className="text-text">{fmtMoney(totals.ask)}</strong></span>
            <span>Your offer: <strong className="text-text">{fmtMoney(totals.offer)}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            {commitErr && <span className="text-sm text-bad">{commitErr}</span>}
            <button className="btn-primary" onClick={commitAll} disabled={committing}>
              {committing ? "Saving…" : "Commit all to Airtable"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Default decision based on the spread (if any). */
function defaultDecision(p: PricedSlab): Decision {
  if (p.spreadPercent != null && p.spreadPercent <= 0) return "Buy";
  if (p.spreadPercent != null && p.spreadPercent > 0.2) return "Pass";
  return "Pending";
}

// ---------- Slab card ----------

function SlabCard({
  idx,
  row,
  scanId,
  patch,
  patchEdit,
  onReprice,
}: {
  idx: number;
  row: RowUi;
  scanId: string;
  patch: (p: Partial<RowUi>) => void;
  patchEdit: (e: Partial<ExtractedSlab>) => void;
  onReprice: () => void;
}) {
  // Show edited values (live preview before re-price).
  const s: ExtractedSlab = { ...row.priced.slab, ...row.edits };
  const p = row.priced.pricing;
  const dirty = Object.keys(row.edits).length > 0 || row.gsidOverride.trim().length > 0;

  return (
    <div className="card space-y-3">
      <div className="flex gap-3">
        <img
          src={`/api/scan/${scanId}/thumb/${idx}`}
          alt={`slab ${idx}`}
          className="rounded-md w-32 h-32 object-cover bg-panel2 border border-border shrink-0"
        />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted">Slab #{idx}</span>
            <StatusBadge status={row.priced.status} />
            <ConfidenceDot c={s.label_confidence} />
            {p?.gsid != null && <span className="badge badge-muted">GSID {p.gsid}</span>}
            <select
              className="select !py-0.5 !px-1 !text-xs !w-auto ml-auto"
              value={row.decision}
              onChange={(e) => patch({ decision: e.target.value as Decision })}
            >
              {(["Pending", "Buy", "Negotiate", "Pass"] as Decision[]).map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          {p?.name && (
            <div className="text-xs text-muted truncate" title={p.name}>{p.name}</div>
          )}
          {row.priced.errorMessage && (
            <div className="text-xs text-bad">{row.priced.errorMessage}</div>
          )}
        </div>
      </div>

      {/* Coin attributes */}
      <div className="grid grid-cols-6 gap-2">
        <Field label="Year" className="col-span-2">
          <input className="input" value={s.year ?? ""} onChange={(e) => patchEdit({ year: e.target.value || null })} />
        </Field>
        <Field label="Mint" className="col-span-1">
          <input className="input" value={s.mint_mark ?? ""} onChange={(e) => patchEdit({ mint_mark: e.target.value || null })} />
        </Field>
        <Field label="Grade" className="col-span-1">
          <input
            className="input"
            inputMode="numeric"
            value={s.grade_numeric ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              patchEdit({ grade_numeric: v === "" ? null : Number(v) });
            }}
          />
        </Field>
        <Field label="Service" className="col-span-2">
          <select
            className="select"
            value={s.grading_service}
            onChange={(e) => patchEdit({ grading_service: e.target.value as GradingService })}
          >
            {SERVICES.map((sv) => <option key={sv} value={sv}>{sv}</option>)}
          </select>
        </Field>

        <Field label="Denomination / series" className="col-span-4">
          <input
            className="input"
            value={s.denomination ?? ""}
            onChange={(e) => patchEdit({ denomination: e.target.value || null })}
            placeholder="e.g. Morgan Dollar"
          />
        </Field>
        <Field label="Variety" className="col-span-2">
          <input
            className="input"
            value={s.variety ?? ""}
            onChange={(e) => patchEdit({ variety: e.target.value || null })}
            placeholder="VAM/FS#"
          />
        </Field>

        <Field label="Grade label" className="col-span-2">
          <input
            className="input"
            value={s.grade_label ?? ""}
            onChange={(e) => patchEdit({ grade_label: e.target.value || null })}
            placeholder="MS65, PR67, Genuine…"
          />
        </Field>
        <Field label="Designation" className="col-span-2">
          <input
            className="input"
            value={s.designation ?? ""}
            onChange={(e) => patchEdit({ designation: e.target.value || null })}
            placeholder="DCAM, FB, PL…"
          />
        </Field>
        <Field label="PCGS#" className="col-span-2">
          <input
            className="input"
            value={s.pcgs_number ?? ""}
            onChange={(e) => patchEdit({ pcgs_number: e.target.value || null })}
            placeholder="e.g. 7160"
          />
        </Field>

        <Field label="Cert #" className="col-span-4">
          <input
            className="input"
            value={s.cert_number ?? ""}
            onChange={(e) => patchEdit({ cert_number: e.target.value || null })}
          />
        </Field>
        <Field label="CAC" className="col-span-2">
          <label className="flex items-center gap-2 h-[38px] px-3 rounded-md border border-border bg-panel">
            <input
              type="checkbox"
              checked={!!s.has_cac_sticker}
              onChange={(e) => patchEdit({ has_cac_sticker: e.target.checked })}
            />
            <span className="text-sm">Sticker present</span>
          </label>
        </Field>
      </div>

      {/* Pricing */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="Their ask" value={fmtMoney(s.handwritten_ask_price)} />
        <Stat label="CDN bid" value={fmtMoney(p?.bid)} accent="good" />
        <Stat label="CDN ask" value={fmtMoney(p?.ask)} />
        <Stat
          label="Spread"
          value={
            row.priced.spreadDollars != null
              ? `${fmtMoney(row.priced.spreadDollars)} (${fmtPct(row.priced.spreadPercent)})`
              : "—"
          }
          accent={
            row.priced.spreadPercent == null
              ? undefined
              : row.priced.spreadPercent <= 0
                ? "good"
                : row.priced.spreadPercent > 0.2
                  ? "bad"
                  : "warn"
          }
        />
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted">More CDN values</summary>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
          <Stat label="PCGS" value={fmtMoney(p?.pcgs)} />
          <Stat label="NGC" value={fmtMoney(p?.ngc)} />
          <Stat label="Blue Book" value={fmtMoney(p?.blueBook)} />
        </div>
      </details>

      {/* Manual override + re-price */}
      <div className="grid grid-cols-6 gap-2 items-end">
        <Field label="Their ask ($)" className="col-span-2">
          <input
            className="input"
            inputMode="decimal"
            value={s.handwritten_ask_price ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              patchEdit({ handwritten_ask_price: v === "" ? null : Number(v) });
            }}
          />
        </Field>
        <Field label="Manual GSID" className="col-span-2">
          <input
            className="input"
            inputMode="numeric"
            value={row.gsidOverride}
            onChange={(e) => patch({ gsidOverride: e.target.value })}
            placeholder="from greysheet.com"
          />
        </Field>
        <div className="col-span-2 flex justify-end">
          <button
            className="btn-primary w-full"
            onClick={onReprice}
            disabled={row.busy || !dirty}
            title={dirty ? "Re-run CDN lookup" : "Edit a field or paste a GSID to re-price"}
          >
            {row.busy ? "Pricing…" : "Re-price"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Your final offer ($)">
          <input
            className="input"
            inputMode="decimal"
            value={row.finalOffer}
            onChange={(e) => patch({ finalOffer: e.target.value })}
            placeholder={p?.bid ? String(p.bid) : ""}
          />
        </Field>
        <Field label="Slab notes">
          <input
            className="input"
            value={row.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder={s.notes ?? "optional"}
          />
        </Field>
      </div>
    </div>
  );
}

// ---------- Small UI bits ----------

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`text-xs space-y-1 ${className}`}>
      <span className="text-muted block">{label}</span>
      {children}
    </label>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "good" | "bad" | "warn";
}) {
  const color =
    accent === "good" ? "text-good" : accent === "bad" ? "text-bad" : accent === "warn" ? "text-warn" : "text-text";
  return (
    <div className="rounded-md bg-panel2 border border-border py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-base font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function ConfidenceDot({ c }: { c: number }) {
  const cls = c >= 0.8 ? "bg-good" : c >= 0.5 ? "bg-warn" : "bg-bad";
  return <span title={`Vision confidence ${(c * 100).toFixed(0)}%`} className={`inline-block w-2 h-2 rounded-full ${cls}`} />;
}

function StatusBadge({ status }: { status: PricedSlab["status"] }) {
  switch (status) {
    case "priced":
      return <span className="badge badge-good">Priced</span>;
    case "no-pricing":
      return <span className="badge badge-warn">No pricing</span>;
    case "needs-mapping":
      return <span className="badge badge-warn">Map manually</span>;
    case "no-credentials":
      return <span className="badge badge-muted">No CDN key</span>;
    case "error":
      return <span className="badge badge-bad">Error</span>;
  }
}
