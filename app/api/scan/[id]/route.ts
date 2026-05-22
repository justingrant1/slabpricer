/**
 * GET    /api/scan/[id]                 → fetch the in-memory session JSON
 * DELETE /api/scan/[id]                 → discard
 */

import { NextResponse } from "next/server";
import { deleteScan, getScan } from "@/lib/scanStore";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = getScan(params.id);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Don't ship the giant data URL back to the client every time — the page
  // already has it from the first render. Send a slim version.
  const { sourceDataUrl, ...rest } = s;
  return NextResponse.json(rest);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  deleteScan(params.id);
  return NextResponse.json({ ok: true });
}
