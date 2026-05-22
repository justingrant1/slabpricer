import { NextResponse } from "next/server";
import { getScan } from "@/lib/scanStore";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const scan = getScan(params.id);
  if (!scan) return new NextResponse("Not found", { status: 404 });
  const b64 = scan.sourceDataUrl.split(",")[1] ?? "";
  return new NextResponse(Buffer.from(b64, "base64"), {
    headers: { "Content-Type": scan.sourceMimeType, "Cache-Control": "private, max-age=3600" },
  });
}
