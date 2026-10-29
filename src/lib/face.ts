"use client";
// Face detection + recognition in the browser with @vladmandic/face-api (TensorFlow.js).
// It runs in a Web Worker (src/workers/face.worker.ts) so the page never freezes while the GPU works;
// browsers without worker WebGL fall back to the main thread. Models are served from /public/models.
// The browser only produces a 128-number face descriptor; matching against the enrolled descriptor
// happens in Postgres (check_punch), so it cannot be faked by editing the page.
import { frameFromLandmarks, type FaceFrame } from "./face-math";
export type { FaceFrame } from "./face-math";

type FaceApi = typeof import("@vladmandic/face-api");
type Engine = { detect: (video: HTMLVideoElement, withDescriptor: boolean) => Promise<FaceFrame | null | "many"> };

let engine: Engine | null = null;
let starting: Promise<Engine> | null = null;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const FRAME_W = 400; // frames are scaled to this width before detection (fast, still accurate)

// ── Worker engine (default) ────────────────────────────────────────────────
function startWorker(): Promise<Engine> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try { w = new Worker(new URL("../workers/face.worker.ts", import.meta.url), { type: "module" }); }
    catch (e) { reject(e); return; }
    let seq = 0;
    const pending = new Map<number, { ok: (v: FaceFrame | null | "many") => void; fail: (e: Error) => void }>();
    const timer = setTimeout(() => { w.terminate(); reject(new Error("Face engine took too long to start")); }, 45000);
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message || "Face worker failed")); };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "ready") {
        clearTimeout(timer);
        resolve({
          async detect(video, withDescriptor) {
            const scale = Math.min(1, FRAME_W / video.videoWidth);
            const frame = await createImageBitmap(video, { resizeWidth: Math.round(video.videoWidth * scale), resizeHeight: Math.round(video.videoHeight * scale), resizeQuality: "medium" });
            const id = ++seq;
            return new Promise((ok, fail) => { pending.set(id, { ok, fail }); w.postMessage({ type: "detect", id, frame, withDescriptor }, [frame]); });
          },
        });
      } else if (m.type === "error") { clearTimeout(timer); w.terminate(); reject(new Error(m.message)); }
      else if (m.type === "result") {
        const p = pending.get(m.id); pending.delete(m.id);
        if (!p) return;
        if (m.error) p.fail(new Error(m.error)); else p.ok(m.result);
      }
    };
    w.postMessage({ type: "init", origin: window.location.origin });
  });
}

// ── Main-thread engine (fallback) ──────────────────────────────────────────
async function startMain(): Promise<Engine> {
  const faceapi: FaceApi = await import("@vladmandic/face-api");
  const tf = faceapi.tf as unknown as { setBackend: (b: string) => Promise<boolean>; ready: () => Promise<void> };
  const okGl = await tf.setBackend("webgl").catch(() => false);
  if (!okGl) await tf.setBackend("cpu");
  await tf.ready();
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
    faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
  ]);
  const c = document.createElement("canvas"); c.width = 160; c.height = 160;
  const g = c.getContext("2d")!; g.fillStyle = "#888"; g.fillRect(0, 0, 160, 160);
  const warm: (() => unknown)[] = [
    async () => { await faceapi.detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 })); },
    () => faceapi.detectFaceLandmarks(c),
    () => faceapi.computeFaceDescriptor(c),
    async () => { await faceapi.detectAllFaces(c, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })); },
  ];
  for (const step of warm) { await nextFrame(); try { await step(); } catch { /* blank canvas */ } }
  const small = document.createElement("canvas");
  let tinyMisses = 0;
  return {
    async detect(video, withDescriptor) {
      const scale = Math.min(1, FRAME_W / video.videoWidth);
      small.width = Math.round(video.videoWidth * scale); small.height = Math.round(video.videoHeight * scale);
      small.getContext("2d")!.drawImage(video, 0, 0, small.width, small.height);
      const useSsd = tinyMisses >= 3;
      const opts = useSsd
        ? new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 3 })
        : new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 });
      const all = withDescriptor
        ? await faceapi.detectAllFaces(small, opts).withFaceLandmarks().withFaceDescriptors()
        : await faceapi.detectAllFaces(small, opts).withFaceLandmarks();
      if (useSsd) tinyMisses = 0; else tinyMisses = all.length ? 0 : tinyMisses + 1;
      if (all.length === 0) return null;
      if (all.length > 1) return "many";
      const f = all[0] as (typeof all)[number] & { descriptor?: Float32Array };
      return frameFromLandmarks(f.landmarks.positions, f.detection.box, small.width, small.height, f.detection.score, f.descriptor);
    },
  };
}

/** Face engine ready (models downloaded and warmed up). Uses the worker, or the main thread if workers cannot run TF.js. */
export function loadFaceApi(): Promise<Engine> {
  if (engine) return Promise.resolve(engine);
  if (!starting) {
    let forceMain = false;
    try { forceMain = localStorage.getItem("hcm-face-engine") === "main"; } catch { /* ignore */ }
    const canWorker = !forceMain && typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined";
    starting = (canWorker ? startWorker().catch((e) => { console.warn("Face worker unavailable, using main thread:", e); return startMain(); }) : startMain())
      .then((e) => { engine = e; return e; })
      .catch((e) => { starting = null; throw e; });
  }
  return starting;
}

/** Start loading in the background when the browser is idle. With the worker this costs the page nothing. */
export function preloadFaceApi() {
  if (typeof window === "undefined" || starting || engine) return;
  const go = () => { loadFaceApi().catch(() => undefined); };
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void };
  if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500);
}

/** One frame: exactly one face with landmarks (and optionally its descriptor). null = no face, "many" = several faces. */
export async function readFace(video: HTMLVideoElement, withDescriptor = false): Promise<FaceFrame | null | "many"> {
  const e = await loadFaceApi();
  return e.detect(video, withDescriptor);
}

export function averageDescriptor(list: Float32Array[]): number[] {
  const out = new Array(128).fill(0);
  list.forEach((x) => x.forEach((v, i) => (out[i] += v / list.length)));
  return out.map((v) => Math.round(v * 1e6) / 1e6);
}

/** Mirrored JPEG snapshot of the current frame (max 480 px wide), as the user sees it. */
export function snapshot(video: HTMLVideoElement): Promise<Blob> {
  const w = Math.min(480, video.videoWidth), h = Math.round((video.videoHeight / video.videoWidth) * w);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.translate(w, 0); ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not capture photo"))), "image/jpeg", 0.85));
}

export function getPosition(timeout = 12000): Promise<{ lat: number; lng: number; acc: number } | { error: string }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ error: "This browser does not support location" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => resolve({ error: e.code === 1 ? "Location permission is blocked. Allow location for this site in your browser settings" : e.code === 3 ? "Location timed out. Turn on GPS and try again" : "Could not get your location" }),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}

/** Great-circle distance in metres (same formula as public.distance_m). */
export function metres(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}
