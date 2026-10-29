"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, Camera, CheckCircle2, Eye, Loader2, RotateCcw, ScanFace, Sun, X } from "lucide-react";
import { Button } from "@/components/ui";
import { averageDescriptor, loadFaceApi, readFace, snapshot } from "@/lib/face";
import { cn } from "@/lib/utils";

export type FaceResult = { descriptor: number[]; photo: Blob; photoUrl: string; samples: number; checks: string[] };
type Step = "straight" | "turn1" | "turn2" | "turn" | "blink";
type Phase = "starting" | "running" | "done" | "error";

const STEP_INFO: Record<Step, { label: string; icon: typeof ScanFace; say: string }> = {
  straight: { label: "Look straight", icon: ScanFace, say: "Look straight at the camera and hold still" },
  turn1: { label: "Turn", icon: ArrowLeftRight, say: "Slowly turn your head to one side" },
  turn2: { label: "Other side", icon: ArrowLeftRight, say: "Now slowly turn to the other side" },
  turn: { label: "Turn", icon: ArrowLeftRight, say: "Slowly turn your head a little to either side" },
  blink: { label: "Blink", icon: Eye, say: "Blink your eyes" },
};

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };

function brightness(video: HTMLVideoElement) {
  const c = document.createElement("canvas"); c.width = 32; c.height = 24;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, 32, 24);
  const d = ctx.getImageData(0, 0, 32, 24).data;
  let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return s / (d.length / 4);
}

/**
 * Live camera face scan with liveness challenges.
 * enroll: look straight (5 samples) → turn to one side → the other side → blink
 * verify: look straight (2 samples) → turn either side → blink
 * Gallery photos are never accepted: only the live camera stream is read.
 * Blink is skipped automatically on very slow devices (under ~4 frames per second).
 */
export function FaceScanner({ mode, onDone, onCancel, compact = false }: { mode: "enroll" | "verify"; onDone: (r: FaceResult) => void; onCancel?: () => void; compact?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const stopped = useRef(false);
  const plan0: Step[] = mode === "enroll" ? ["straight", "turn1", "turn2", "blink"] : ["straight", "turn", "blink"];
  const [phase, setPhase] = useState<Phase>("starting");
  const [steps, setSteps] = useState<Step[]>(plan0);
  const [stepIdx, setStepIdx] = useState(0);
  const [hint, setHint] = useState("Starting camera…");
  const [aligned, setAligned] = useState(false);
  const [samples, setSamples] = useState(0);
  const [error, setError] = useState("");
  const [run, setRun] = useState(0);
  const need = mode === "enroll" ? 5 : 2;

  const stop = useCallback(() => { stopped.current = true; stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; }, []);

  useEffect(() => {
    stopped.current = false;
    setPhase("starting"); setStepIdx(0); setSamples(0); setError(""); setAligned(false); setHint("Starting camera…"); setSteps(plan0);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera is not available here. Open the app over https (or localhost) in Chrome, Edge or Safari.");
        const [s] = await Promise.all([
          navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }),
          loadFaceApi(),
        ]);
        if (stopped.current) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play();
        setPhase("running");
        await scan(v);
      } catch (e) {
        const err = e as Error;
        setError(err.name === "NotAllowedError" ? "Camera permission is blocked. Allow the camera for this site (lock icon in the address bar) and try again."
          : err.name === "NotFoundError" ? "No camera found on this device." : err.message || "Could not start the camera.");
        setPhase("error");
      }
    })();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, mode]);

  async function scan(v: HTMLVideoElement) {
    let plan = [...plan0];
    let i = 0;
    const descs: Float32Array[] = [], yaws: number[] = [], ears: number[] = [];
    let photo: Blob | null = null, side = 0, peak = 0, closed = false, frames = 0, lastBright = 0;
    let debug = false;
    try { debug = !!localStorage.getItem("hcm-face-debug"); } catch { /* ignore */ }
    const checks: string[] = [];
    const t0 = performance.now();
    let limit = 60000;
    try { const x = Number(localStorage.getItem("hcm-face-timeout")); if (x > 0) limit = x; } catch { /* ignore */ }

    let lastFrame = performance.now(), lastDesc = 0, frameMs = 0;
    while (!stopped.current && i < plan.length) {
      // Yield to the browser every frame (paint + input) and cap at ~10 checks a second so the page never locks up.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const gap = performance.now() - lastFrame;
      if (gap < 100) await new Promise((r) => setTimeout(r, 100 - gap));
      if (stopped.current) return;
      if (performance.now() - t0 > limit) { setError("The face scan took too long. Use good light, remove mask or sunglasses, hold the phone at eye level and try again."); setPhase("error"); stop(); return; }
      const step = plan[i];
      const wantDesc = step === "straight" && performance.now() - lastDesc > 300;
      const started = performance.now();
      const f = await readFace(v, wantDesc);
      if (wantDesc) lastDesc = performance.now();
      if (stopped.current) return;
      frames++;
      const now = performance.now();
      frameMs = frameMs ? frameMs * 0.7 + (now - started) * 0.3 : now - started; // recent detection time
      lastFrame = now;
      const fps = 1000 / Math.max(frameMs, 100);
      if (frames % 6 === 1) lastBright = brightness(v);
      if (lastBright && lastBright < 40) { setAligned(false); setHint("It is too dark — move to a brighter place"); continue; }
      if (f === "many") { setAligned(false); setHint("Only one person should be in front of the camera"); continue; }
      if (!f) { setAligned(false); setHint("Bring your face inside the oval"); continue; }
      if (f.size < 0.2) { setAligned(false); setHint("Move a little closer"); continue; }
      if (f.size > 0.85) { setAligned(false); setHint("Move back a little"); continue; }
      if (Math.abs(f.centre.x - 0.5) > 0.22 || Math.abs(f.centre.y - 0.5) > 0.25) { setAligned(false); setHint("Centre your face in the oval"); continue; }
      setAligned(true);
      if (debug) console.log(`[face] step=${step} yaw=${f.yaw.toFixed(3)} ear=${f.ear.toFixed(3)} size=${f.size.toFixed(2)} fps=${fps.toFixed(2)}`);

      if (step === "straight") {
        setHint(STEP_INFO.straight.say);
        if (f.descriptor) { descs.push(f.descriptor); yaws.push(f.yaw); ears.push(f.ear); setSamples(descs.length); if (!photo) photo = await snapshot(v); }
        if (descs.length >= need) { checks.push("straight"); i++; setStepIdx(i); }
        continue;
      }
      const base = median(yaws);
      if (step === "turn1" || step === "turn") {
        setHint(STEP_INFO[step].say);
        if (Math.abs(f.yaw - base) >= 0.07) { side = Math.sign(f.yaw - base); peak = f.yaw; checks.push("turn"); i++; setStepIdx(i); }
        continue;
      }
      if (step === "turn2") {
        setHint(STEP_INFO.turn2.say);
        // Track how far they went to the first side, then require a swing back past centre to the other side.
        if ((f.yaw - peak) * side > 0) peak = f.yaw;
        if ((f.yaw - base) * side <= -0.02 && (peak - f.yaw) * side >= 0.12) { checks.push("turn_both"); i++; setStepIdx(i); }
        continue;
      }
      if (step === "blink") {
        // Very slow devices cannot see a blink reliably: skip rather than block the employee.
        if (frames > 6 && fps < 4) { plan = plan.filter((s) => s !== "blink"); setSteps(plan); break; }
        setHint(STEP_INFO.blink.say);
        const open = median(ears);
        if (!closed && f.ear < open * 0.72) closed = true;
        else if (closed && f.ear > open * 0.88) { checks.push("blink"); i++; setStepIdx(i); }
      }
    }
    if (stopped.current || !photo) return;
    setPhase("done"); setStepIdx(plan.length); setHint(mode === "enroll" ? "Face captured" : "Face scanned");
    stop();
    const url = URL.createObjectURL(photo);
    setTimeout(() => onDone({ descriptor: averageDescriptor(descs), photo: photo!, photoUrl: url, samples: descs.length, checks }), 450);
  }

  const current = steps[Math.min(stepIdx, steps.length - 1)];
  const Icon = STEP_INFO[current].icon;
  const progress = phase === "done" ? 1 : (stepIdx + (current === "straight" ? Math.min(samples / need, 1) * 0.9 : 0)) / steps.length;

  return (
    <div className="flex flex-col items-center">
      <div className="mb-4 flex flex-wrap justify-center gap-1.5">
        {steps.map((s, k) => {
          const I = STEP_INFO[s].icon; const done = k < stepIdx || phase === "done"; const active = k === stepIdx && phase === "running";
          return (
            <span key={s} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition",
              done ? "bg-emerald-500/15 text-emerald-600" : active ? "brand-gradient text-white shadow-sm" : "bg-surface-muted text-ink-soft")}>
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <I className="h-3.5 w-3.5" />}{STEP_INFO[s].label}
            </span>
          );
        })}
      </div>

      <div className={cn("relative overflow-hidden rounded-[2rem] bg-slate-950 shadow-pop", compact ? "aspect-[3/4] w-64" : "aspect-[3/4] w-full max-w-[340px]")}>
        <video ref={video} playsInline muted className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 300 400" preserveAspectRatio="none">
          <defs><mask id="oval-hole"><rect width="300" height="400" fill="white" /><ellipse cx="150" cy="185" rx="105" ry="140" fill="black" /></mask></defs>
          <rect width="300" height="400" fill="rgba(2,6,23,0.55)" mask="url(#oval-hole)" />
          <ellipse cx="150" cy="185" rx="105" ry="140" fill="none" strokeWidth="4" strokeLinecap="round"
            className={cn("transition-colors duration-300", aligned || phase === "done" ? "stroke-emerald-400" : "stroke-white/70")}
            strokeDasharray={aligned || phase === "done" ? "0" : "10 9"} />
          <ellipse cx="150" cy="185" rx="113" ry="148" fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-sky-400 transition-all duration-500"
            pathLength={100} strokeDasharray={`${progress * 100} 100`} />
        </svg>
        {phase === "starting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/90">
            <Loader2 className="h-9 w-9 animate-spin" /><p className="text-sm">Preparing secure face scan…</p>
          </div>
        )}
        {phase === "running" && (current === "turn1" || current === "turn2" || current === "turn") && (
          <div className="pointer-events-none absolute inset-x-0 top-[42%] flex justify-between px-4 text-4xl font-light text-white">
            <span className="animate-pulse">‹</span><span className="animate-pulse">›</span>
          </div>
        )}
        {phase === "done" && (
          <div className="absolute inset-0 flex items-center justify-center bg-emerald-600/30">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-xl animate-fade-up"><CheckCircle2 className="h-12 w-12 text-emerald-500" /></div>
          </div>
        )}
        {phase === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/85 p-6 text-center text-white">
            <Camera className="h-9 w-9 text-rose-300" /><p className="text-sm" data-testid="face-error">{error}</p>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 to-transparent px-4 pb-4 pt-10 text-center">
          <p className="flex min-h-10 items-center justify-center gap-2 text-sm font-semibold text-white" data-testid="face-hint">
            {phase === "running" && <Icon className="h-4 w-4 shrink-0" />}{phase === "error" ? "Scan stopped" : hint}
          </p>
          {phase === "running" && current === "straight" && <p className="text-[11px] text-white/70">{samples}/{need} captured</p>}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {phase === "error" && <Button onClick={() => setRun((r) => r + 1)}><RotateCcw className="h-4 w-4" />Try again</Button>}
        {onCancel && phase !== "done" && <Button variant="ghost" onClick={() => { stop(); onCancel(); }}>Cancel</Button>}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-center text-[11px] text-ink-soft"><Sun className="h-3.5 w-3.5" />Face the light · remove mask and sunglasses · live camera only</p>
    </div>
  );
}

/** Modal wrapper used for clock-in / clock-out checks and HR-assisted enrollment. */
export function FaceCapture({ open, mode, onDone, onClose, title }: {
  open: boolean; mode: "enroll" | "verify"; onDone: (r: FaceResult) => void; onClose: () => void; title?: string;
}) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-[2rem] bg-surface p-5 shadow-pop animate-fade-up" data-testid="face-modal">
        <div className="mb-4 flex items-center justify-between">
          <p className="flex items-center gap-2 font-semibold text-ink"><span className="brand-gradient flex h-8 w-8 items-center justify-center rounded-xl text-white"><ScanFace className="h-4 w-4" /></span>{title ?? (mode === "enroll" ? "Set up Face ID" : "Face check")}</p>
          <button onClick={onClose} className="cursor-pointer rounded-lg p-1 text-ink-soft hover:bg-surface-muted" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <FaceScanner mode={mode} onDone={onDone} onCancel={onClose} />
      </div>
    </div>,
    document.body,
  );
}
