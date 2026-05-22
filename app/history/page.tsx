/**
 * /history — read-only list of every Scan Ben has committed to Airtable.
 *
 * We deliberately go straight to Airtable (not our in-memory store) so this
 * survives serverless cold starts and is the same data Ben can edit in the
 * Airtable UI.
 */

import Link from "next/link";
import { listScans } from "@/lib/airtable";
import { hasAirtableCreds } from "@/lib/env";

export const dynamic = "force-dynamic";

function fmtMoney(n: number | null) {
  if (n == null) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams?: { committed?: string };
}) {
  const justCommitted = searchParams?.committed === "1";

  if (!hasAirtableCreds()) {
    return (
      <main className="mx-auto max-w-3xl p-6 space-y-4">
        <h1 className="text-xl font-semibold">History</h1>
        <div className="card text-sm">
          Airtable credentials aren't set yet. Add <code>AIRTABLE_TOKEN</code>,{" "}
          <code>AIRTABLE_BASE_ID</code>, <code>AIRTABLE_SCANS_TABLE</code> and{" "}
          <code>AIRTABLE_SLABS_TABLE</code> to your <code>.env.local</code>.
        </div>
        <Link href="/" className="btn">← Back to scanner</Link>
      </main>
    );
  }

  let rows: Awaited<ReturnType<typeof listScans>> = [];
  let err: string | null = null;
  try {
    rows = await listScans(100);
  } catch (e: any) {
    err = e?.message ?? String(e);
  }

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">History</h1>
        <Link href="/" className="btn">+ New Scan</Link>
      </div>

      {justCommitted && (
        <div className="card border-good/50 bg-good/10 text-sm">
          ✓ Scan committed to Airtable.
        </div>
      )}

      {err && (
        <div className="card border-bad/50 bg-bad/10 text-sm text-bad">
          Failed to load Airtable: {err}
        </div>
      )}

      {!err && rows.length === 0 && (
        <div className="card text-sm text-muted">
          No scans yet. Upload a dealer photo on the home page to get started.
        </div>
      )}

      {rows.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-panel2 text-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left p-3">When</th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Source</th>
                <th className="text-right p-3">Slabs</th>
                <th className="text-right p-3">Their ask</th>
                <th className="text-right p-3">CDN bid</th>
                <th className="text-right p-3">Spread</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const spread =
                  r.totalAsk != null && r.totalBid != null ? r.totalAsk - r.totalBid : null;
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-panel2/60">
                    <td className="p-3 whitespace-nowrap text-muted">
                      {r.scannedAt ? new Date(r.scannedAt).toLocaleString() : "—"}
                    </td>
                    <td className="p-3">{r.name || "(unnamed)"}</td>
                    <td className="p-3">{r.source || "—"}</td>
                    <td className="p-3 text-right">{r.slabCount ?? "—"}</td>
                    <td className="p-3 text-right">{fmtMoney(r.totalAsk)}</td>
                    <td className="p-3 text-right text-good">{fmtMoney(r.totalBid)}</td>
                    <td
                      className={`p-3 text-right ${
                        spread == null ? "" : spread <= 0 ? "text-good" : "text-bad"
                      }`}
                    >
                      {fmtMoney(spread)}
                    </td>
                    <td className="p-3">
                      <span className="badge badge-muted">{r.status || "—"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted">
        Showing the {rows.length} most recent scans. Open Airtable for the full table and
        per-slab detail.
      </p>
    </main>
  );
}
