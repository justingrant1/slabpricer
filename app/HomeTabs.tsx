"use client";

/**
 * Two-tab landing page:
 *   1. "Dealer photo"  — existing UploadCard (vision → CDN)
 *   2. "Slab in hand"  — new SlabInHandCard (PCGS barcode/cert → CDN)
 */

import { useState } from "react";
import { Image as ImageIcon, IdCard } from "lucide-react";
import UploadCard from "./UploadCard";
import SlabInHandCard from "./SlabInHandCard";
import { cn } from "@/lib/cn";

type Tab = "photo" | "hand";

export default function HomeTabs() {
  const [tab, setTab] = useState<Tab>("photo");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">New Scan</h1>
        <p className="text-sm text-muted">
          Two ways to look up bid/ask: drop a dealer photo of a tray of slabs, or scan a single
          slab in your hand.
        </p>
      </div>

      <div className="flex gap-2 border-b border-border pb-3">
        <TopTab active={tab === "photo"} onClick={() => setTab("photo")} icon={<ImageIcon className="w-4 h-4" />}>
          Dealer photo
        </TopTab>
        <TopTab active={tab === "hand"} onClick={() => setTab("hand")} icon={<IdCard className="w-4 h-4" />}>
          Slab in hand
        </TopTab>
      </div>

      {tab === "photo" ? <UploadCard /> : <SlabInHandCard />}
    </div>
  );
}

function TopTab(props: { active: boolean; onClick: () => void; children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition",
        props.active
          ? "bg-accent text-accent-fg"
          : "border border-border bg-surface-2 text-muted hover:text-fg",
      )}
    >
      {props.icon}
      {props.children}
    </button>
  );
}
