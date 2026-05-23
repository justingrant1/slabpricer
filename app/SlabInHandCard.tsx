"use client";

/**
 * "Slab in hand" lookup card.
 *
 *   - Tab 1: Scan a slab barcode with the device camera (live, auto-submits
 *     on first valid read). Uses native BarcodeDetector when available
 *     (iOS 17+, Chrome desktop/Android), falls back to @zxing/browser.
 *   - Tab 2: Type / paste a cert number, choose PCGS or NGC, submit.
 *
 * Both paths POST to /api/lookup and then redirect to /scan/[id].
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Keyboard, ScanLine, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Service = "PCGS" | "NGC";
type Mode = "scan" | "type";

export default function SlabInHandCard() {
  const [mode, setMode] = useState<Mode>("scan");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-border bg-surface p-4 sm:p-6 space-y-4">
      <div className="flex gap-2">
        <TabButton active={mode === "scan"} onClick={() => setMode("scan")} icon={<Camera className="w-4 h-4" />}>
          Scan barcode
        </TabButton>
        <TabButton active={mode === "type"} onClick={() => setMode("type")} icon={<Keyboard className="w-4 h-4" />}>
          Enter cert #
        </TabButton>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {mode === "scan" ? (
        <ScanPane
          disabled={submitting}
          setSubmitting={setSubmitting}
          setError={setError}
        />
      ) : (
        <TypePane disabled={submitting} setSubmitting={setSubmitting} setError={setError} />
      )}

      <p className="text-xs text-muted">
        Looks up the slab via PCGS (works for both PCGS and NGC barcodes) and pulls bid/ask from CDN.
      </p>
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border transition",
        props.active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border bg-surface-2 text-muted hover:text-fg",
      )}
    >
      {props.icon}
      {props.children}
    </button>
  );
}

// ============================================================
// Scan pane
// ============================================================

function ScanPane(props: {
  disabled: boolean;
  setSubmitting: (b: boolean) => void;
  setError: (s: string | null) => void;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [running, setRunning] = useState(false);
  const [hint, setHint] = useState<string>("Tap Start to use the camera.");
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  // Stop any running streams / scanners on unmount.
  const stopFnRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      stopFnRef.current?.();
    };
  }, []);

  /**
   * Some Android Chrome builds expose a `zoom` constraint on the
   * MediaStreamTrack that DRAMATICALLY improves small-barcode reads.
   * Bumping zoom to ~2x is usually the difference between "no read" and
   * "instant lock" on a slab barcode held 6–8 inches away.
   */
  async function maybeBoostZoom(track: MediaStreamTrack) {
    try {
      const caps = (track.getCapabilities?.() ?? {}) as any;
      if (typeof caps.zoom?.min === "number" && typeof caps.zoom?.max === "number") {
        const target = Math.min(caps.zoom.max, Math.max(caps.zoom.min, 2.0));
        await track.applyConstraints({ advanced: [{ zoom: target } as any] });
      }
      // Also try to lock focus to continuous if supported.
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
        await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as any] });
      }
    } catch {
      /* not all browsers support these; ignore */
    }
  }

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next } as any] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }

  async function start() {
    props.setError(null);
    setLastCode(null);
    setRunning(true);
    setHint("Requesting camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = stream.getVideoTracks()[0];
      trackRef.current = track ?? null;
      if (track) {
        const caps = (track.getCapabilities?.() ?? {}) as any;
        setTorchAvailable(Boolean(caps.torch));
        await maybeBoostZoom(track);
      }

      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play().catch(() => {
        /* iOS sometimes resolves play() late; ignore */
      });
      setHint("Aim at the barcode. Hold steady ~6 inches away.");

      const onDecoded = async (text: string) => {
        if (!text) return;
        setLastCode(text);
        stopFnRef.current?.();
        await submitBarcode(text);
      };

      // ----------------------------------------------------------------
      // Decoder selection.
      //
      // Path A (preferred): the browser's built-in BarcodeDetector. Native
      //   code, ~10x faster than zxing-js, supports every format PCGS/NGC use.
      //   Available on iOS 17+ Safari, recent Chrome desktop, Chrome Android.
      //
      // Path B (fallback): @zxing/browser. We DO NOT call
      //   `decodeFromVideoElement` because that helper re-opens the camera
      //   with its own getUserMedia — which on iOS Safari either steals the
      //   stream we already have or silently fails. Instead we hand zxing the
      //   <video> element we already attached the stream to and pump frames
      //   ourselves via decodeOnceFromVideoElement in a loop.
      // ----------------------------------------------------------------
      const NativeBD: any = (window as any).BarcodeDetector;
      if (NativeBD && typeof NativeBD === "function") {
        let supportedFormats: string[] | undefined;
        try {
          supportedFormats = await NativeBD.getSupportedFormats?.();
        } catch {
          /* not all impls expose this */
        }
        const wanted = [
          "code_128",
          "code_39",
          "code_93",
          "ean_13",
          "ean_8",
          "qr_code",
          "data_matrix",
          "pdf417",
          "upc_a",
          "upc_e",
          "itf",
        ];
        const formats = supportedFormats?.length
          ? wanted.filter((f) => supportedFormats!.includes(f))
          : wanted;

        const detector = new NativeBD({ formats });
        let cancelled = false;
        const loop = async () => {
          if (cancelled) return;
          try {
            // detect() can throw "InvalidStateError" if the video isn't ready yet.
            if (video.readyState >= 2) {
              const results = await detector.detect(video);
              if (results?.length) {
                const value = results[0].rawValue ?? results[0].rawData ?? "";
                if (value) {
                  cancelled = true;
                  onDecoded(String(value));
                  return;
                }
              }
            }
          } catch {
            /* swallow per-frame errors */
          }
          if (!cancelled) requestAnimationFrame(loop);
        };
        loop();
        stopFnRef.current = () => {
          cancelled = true;
          stream.getTracks().forEach((t) => t.stop());
          trackRef.current = null;
          setTorchOn(false);
          setTorchAvailable(false);
          setRunning(false);
        };
      } else {
        // Path B: zxing fallback. Pump frames manually from our existing <video>.
        const zxing = await import("@zxing/browser");
        const { BrowserMultiFormatReader } = zxing;
        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 100,
        } as any);
        let cancelled = false;

        const tick = async () => {
          if (cancelled) return;
          try {
            if (video.readyState >= 2) {
              // `decodeOnceFromVideoElement` reads exactly one frame and
              // resolves/throws. Throwing NotFoundException just means "no
              // barcode this frame" — we ignore and keep ticking.
              const result = await reader.decodeOnceFromVideoElement(video);
              if (result) {
                cancelled = true;
                onDecoded(result.getText());
                return;
              }
            }
          } catch {
            /* NotFoundException etc. — try again */
          }
          if (!cancelled) requestAnimationFrame(tick);
        };
        tick();

        stopFnRef.current = () => {
          cancelled = true;
          stream.getTracks().forEach((t) => t.stop());
          trackRef.current = null;
          setTorchOn(false);
          setTorchAvailable(false);
          setRunning(false);
        };
      }
    } catch (e: any) {
      props.setError(`Camera unavailable: ${e?.message ?? e}. Use "Enter cert #" instead.`);
      setRunning(false);
    }
  }

  async function submitBarcode(barcode: string) {
    props.setSubmitting(true);
    setHint(`Looking up ${barcode}…`);
    try {
      const resp = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error ?? `HTTP ${resp.status}`);
      router.push(`/scan/${json.id}`);
    } catch (e: any) {
      props.setError(e?.message ?? String(e));
      props.setSubmitting(false);
      setRunning(false);
      setHint("Try again, or switch to manual entry.");
    }
  }

  function stop() {
    stopFnRef.current?.();
    setHint("Stopped. Tap Start to scan again.");
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-black border border-border">
        <video
          ref={videoRef}
          playsInline
          muted
          className={cn("h-full w-full object-cover", !running && "opacity-30")}
        />
        {/* Reticle */}
        {running && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="w-3/4 h-1/3 border-2 border-accent/80 rounded-md flex items-center justify-center">
              <ScanLine className="w-10 h-10 text-accent/80 animate-pulse" />
            </div>
          </div>
        )}
        {!running && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              onClick={start}
              disabled={props.disabled}
              className="px-4 py-2 rounded-md bg-accent text-accent-fg font-medium hover:bg-accent/90 disabled:opacity-50"
            >
              Start camera
            </button>
          </div>
        )}

        {/* Floating controls while the camera is live. */}
        {running && (
          <div className="absolute top-2 right-2 flex gap-2">
            {torchAvailable && (
              <button
                type="button"
                onClick={toggleTorch}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium border",
                  torchOn
                    ? "bg-amber-400/90 text-black border-amber-300"
                    : "bg-black/60 text-white border-white/30 hover:bg-black/80",
                )}
                title={torchOn ? "Turn flashlight off" : "Turn flashlight on"}
              >
                {torchOn ? "🔦 On" : "🔦"}
              </button>
            )}
            <button
              type="button"
              onClick={stop}
              className="rounded-md px-2.5 py-1 text-xs font-medium border bg-black/60 text-white border-white/30 hover:bg-black/80"
              title="Stop camera"
            >
              ✕
            </button>
          </div>
        )}
      </div>
      <p className="text-sm text-muted">{hint}</p>
      {lastCode && (
        <div className="flex items-center gap-2 text-sm text-emerald-300">
          <CheckCircle2 className="w-4 h-4" />
          Read: <span className="font-mono">{lastCode}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Type pane
// ============================================================

function TypePane(props: { disabled: boolean; setSubmitting: (b: boolean) => void; setError: (s: string | null) => void }) {
  const router = useRouter();
  const [certNo, setCertNo] = useState("");
  const [service, setService] = useState<Service>("PCGS");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = certNo.trim();
    if (!clean) {
      props.setError("Cert number required.");
      return;
    }
    props.setError(null);
    setBusy(true);
    props.setSubmitting(true);
    try {
      const resp = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certNo: clean, service }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error ?? `HTTP ${resp.status}`);
      router.push(`/scan/${json.id}`);
    } catch (e: any) {
      props.setError(e?.message ?? String(e));
      setBusy(false);
      props.setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="block text-xs text-muted mb-1">Cert number</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={certNo}
            onChange={(e) => setCertNo(e.target.value.replace(/\s+/g, ""))}
            placeholder="e.g. 12345678"
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm font-mono"
            disabled={busy || props.disabled}
            autoFocus
          />
        </label>
        <label className="w-28">
          <span className="block text-xs text-muted mb-1">Service</span>
          <select
            value={service}
            onChange={(e) => setService(e.target.value as Service)}
            disabled={busy || props.disabled}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
          >
            <option value="PCGS">PCGS</option>
            <option value="NGC">NGC</option>
          </select>
        </label>
      </div>
      <button
        type="submit"
        disabled={busy || props.disabled}
        className="inline-flex items-center gap-2 rounded-md bg-accent text-accent-fg px-4 py-2 text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        Look up
      </button>
    </form>
  );
}
