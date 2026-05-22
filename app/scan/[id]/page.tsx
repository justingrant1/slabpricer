import { notFound } from "next/navigation";
import { getScan } from "@/lib/scanStore";
import ReviewClient from "./ReviewClient";

export const metadata = { title: "Review Scan · Slab Pricer" };
export const dynamic = "force-dynamic";

export default function ScanReviewPage({ params }: { params: { id: string } }) {
  const scan = getScan(params.id);
  if (!scan) notFound();

  // Pass everything except the giant sourceDataUrl. The client fetches the
  // image and thumbs via /api endpoints instead — keeps the initial HTML small.
  const { sourceDataUrl, ...slim } = scan;

  return (
    <ReviewClient
      scanId={scan.id}
      initial={slim}
      sourceImgUrl={`/api/scan/${scan.id}/source`}
    />
  );
}
