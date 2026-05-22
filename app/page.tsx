import UploadCard from "./UploadCard";

export const metadata = { title: "New Scan · Slab Pricer" };

export default function Home() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">New Scan</h1>
        <p className="text-sm text-muted">
          Drop a dealer photo, paste from clipboard, or use your phone camera. We'll detect
          every slab on the label and pull bid/ask from the CDN Greysheet API.
        </p>
      </div>
      <UploadCard />
    </div>
  );
}
