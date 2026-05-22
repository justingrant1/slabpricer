"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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

  async function onAnalyze() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (source.trim()) fd.append("source", source.trim());
      const res = await fetch("/api/scan", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      router.push(`/scan/${json.id}`);
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
      setBusy(false);
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
          {busy ? "Analyzing… (10–30s)" : "Analyze slabs →"}
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
