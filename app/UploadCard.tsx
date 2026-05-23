"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Vercel serverless functions have a hard 4.5MB request body limit.
 * Modern phone photos are routinely 6–15MB, so we re-encode every upload
 * client-side to a JPEG with longest edge ≤ MAX_EDGE before sending.
 *
 * We try progressively lower quality settings if we still exceed BYTE_LIMIT.
 * (We never drop below 1600px on the long edge — the server-side vision
 * pipeline still wants enough resolution to read fine label text on a tray
 * of 10+ slabs.)
 */
const MAX_EDGE = 3200;
const MIN_EDGE = 1600;
const BYTE_LIMIT = 4_000_000; // 4 MB, comfortably under Vercel's 4.5 MB
const QUALITIES = [0.88, 0.82, 0.75, 0.65];

async function compressImage(file: File): Promise<File> {
  // If it's already small enough and a JPEG/PNG/WebP, leave it alone.
  if (file.size <= BYTE_LIMIT && /^image\/(jpeg|png|webp)$/.test(file.type)) {
    return file;
  }

  const bitmap = await loadBitmap(file);
  for (const edge of [MAX_EDGE, 2400, MIN_EDGE]) {
    const { canvas } = drawToCanvas(bitmap, edge);
    for (const q of QUALITIES) {
      const blob = await canvasToJpegBlob(canvas, q);
      if (blob.size <= BYTE_LIMIT) {
        return new File([blob], renameToJpg(file.name), { type: "image/jpeg" });
      }
    }
  }
  // Last resort — return what we got at the smallest edge / quality.
  const { canvas } = drawToCanvas(bitmap, MIN_EDGE);
  const blob = await canvasToJpegBlob(canvas, QUALITIES[QUALITIES.length - 1]);
  return new File([blob], renameToJpg(file.name), { type: "image/jpeg" });
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img> fallback (e.g. for HEIC on some browsers)
    }
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = URL.createObjectURL(file);
  });
}

function drawToCanvas(
  source: ImageBitmap | HTMLImageElement,
  maxEdge: number,
): { canvas: HTMLCanvasElement; w: number; h: number } {
  const srcW = "width" in source ? source.width : (source as HTMLImageElement).naturalWidth;
  const srcH = "height" in source ? source.height : (source as HTMLImageElement).naturalHeight;
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("No 2D canvas context");
  // White background in case the source has transparency.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  return { canvas, w, h };
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      "image/jpeg",
      quality,
    );
  });
}

function renameToJpg(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
}


/**
 * Image intake card.
 *
 * Supports:
 *   - File picker (with capture="environment" on mobile → opens rear camera)
 *   - Drag & drop
 *   - Paste (Cmd/Ctrl+V) of an image from clipboard
 *
 * Shows a thumbnail preview, optional dealer/source label, and an Analyze button.
 * On submit it POSTs multipart/form-data to /api/scan and navigates to /scan/[id].
 */
export default function UploadCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const onPick = useCallback((f: File | null) => {
    setError(null);
    if (!f) {
      setFile(null);
      setPreview(null);
      return;
    }
    if (!f.type.startsWith("image/")) {
      setError("That doesn't look like an image.");
      return;
    }
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }, []);

  // Paste handler — listen on the window so it works anywhere on the page.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData) return;
      for (const item of e.clipboardData.items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            onPick(new File([blob], `pasted-${Date.now()}.png`, { type: blob.type }));
            e.preventDefault();
            return;
          }
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onPick]);

  // Revoke preview URLs to avoid leaking memory.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const [stage, setStage] = useState<"compressing" | "uploading" | null>(null);

  async function onAnalyze() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      // 1. Compress client-side to stay under Vercel's 4.5MB body limit.
      setStage("compressing");
      let upload = file;
      try {
        upload = await compressImage(file);
      } catch (e) {
        console.warn("[upload] compression failed, sending original:", e);
      }

      // 2. POST to /api/scan. We need to handle non-JSON error bodies too
      //    (Vercel returns a plain "Request Entity Too Large" string on 413).
      setStage("uploading");
      const fd = new FormData();
      fd.append("file", upload);
      if (source.trim()) fd.append("source", source.trim());
      const res = await fetch("/api/scan", { method: "POST", body: fd });

      if (!res.ok) {
        const text = await res.text();
        let msg = text || `HTTP ${res.status}`;
        try {
          msg = JSON.parse(text).error ?? msg;
        } catch {
          // not JSON — keep raw text
        }
        if (res.status === 413) {
          msg = "Image is too large even after compression. Try a smaller photo.";
        }
        throw new Error(msg);
      }

      const json = await res.json();
      router.push(`/scan/${json.id}`);
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
      setBusy(false);
      setStage(null);
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onPick(e.dataTransfer.files?.[0] ?? null);
        }}
        className={`card border-2 border-dashed transition-colors ${
          dragOver ? "border-accent bg-accent/5" : "border-border"
        }`}
      >
        {preview ? (
          <div className="space-y-3">
            <img
              src={preview}
              alt="preview"
              className="max-h-[420px] mx-auto rounded-md object-contain"
            />
            <div className="flex items-center justify-between text-xs text-muted">
              <span>{file?.name}</span>
              <button
                className="text-muted hover:text-text underline"
                onClick={() => onPick(null)}
                disabled={busy}
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="py-10 text-center text-muted space-y-3">
            <div className="text-4xl">📷</div>
            <p className="text-sm">
              Drag &amp; drop an image, paste from clipboard, or choose a file.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button className="btn" onClick={() => inputRef.current?.click()} disabled={busy}>
                Choose file
              </button>
              <button className="btn" onClick={() => cameraRef.current?.click()} disabled={busy}>
                Use camera
              </button>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
        <input
          className="input"
          placeholder="Source / dealer name (optional)"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          disabled={busy}
        />
        <button className="btn-primary" disabled={!file || busy} onClick={onAnalyze}>
          {busy
            ? stage === "compressing"
              ? "Compressing image…"
              : "Analyzing… (10–30s)"
            : "Analyze slabs →"}
        </button>
      </div>

      {error && (
        <div className="card border-bad text-sm text-bad">
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  );
}
