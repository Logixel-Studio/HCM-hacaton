"use client";
// Face detection + recognition in the browser with @vladmandic/face-api (TensorFlow.js).
// Models are served from /public/models (copied from the npm package on install), so no
// image ever leaves the device except the selfie the company stores for audit.
// The browser only produces a 128-number face descriptor; matching against the enrolled
// descriptor happens in Postgres (check_punch), so it cannot be faked by editing the page.

type FaceApi = typeof import("@vladmandic/face-api");
let api: FaceApi | null = null;
let loading: Promise<FaceApi> | null = null;

export async function loadFaceApi(): Promise<FaceApi> {
  if (api) return api;
  if (!loading) {
    loading = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      const tf = faceapi.tf as unknown as { setBackend: (b: string) => Promise<boolean>; ready: () => Promise<void> };
      await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
      await tf.ready();
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      api = faceapi;
      return faceapi;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

export type FaceFrame = {
  yaw: number;        // nose position along the eye line: ≈0.5 facing the camera, lower/higher when turned
  ear: number;        // eye aspect ratio (open ≈0.3, closed ≈0.1)
  size: number;       // face width ÷ frame width
  score: number;      // detector confidence
  centre: { x: number; y: number }; // face centre, 0..1
  descriptor?: Float32Array;
};

type P = { x: number; y: number };
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const eyeRatio = (e: P[]) => (dist(e[1], e[5]) + dist(e[2], e[4])) / (2 * Math.max(1, dist(e[0], e[3])));

/** One frame: exactly one face with landmarks (and optionally its descriptor). null = no face, "many" = several faces. */
export async function readFace(video: HTMLVideoElement, withDescriptor = false): Promise<FaceFrame | null | "many"> {
  const faceapi = await loadFaceApi();
  const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 3 });
  const all = withDescriptor
    ? await faceapi.detectAllFaces(video, opts).withFaceLandmarks().withFaceDescriptors()
    : await faceapi.detectAllFaces(video, opts).withFaceLandmarks();
  if (all.length === 0) return null;
  if (all.length > 1) return "many";
  const f = all[0] as (typeof all)[number] & { descriptor?: Float32Array };
  const p = f.landmarks.positions;
  const l = p[36], r = p[45], nose = p[30];
  const ex = r.x - l.x, ey = r.y - l.y;
  const yaw = ((nose.x - l.x) * ex + (nose.y - l.y) * ey) / Math.max(1, ex * ex + ey * ey); // robust to head tilt
  const ear = (eyeRatio(p.slice(36, 42)) + eyeRatio(p.slice(42, 48))) / 2;
  const box = f.detection.box;
  return {
    yaw, ear, size: box.width / video.videoWidth, score: f.detection.score,
    centre: { x: (box.x + box.width / 2) / video.videoWidth, y: (box.y + box.height / 2) / video.videoHeight },
    descriptor: f.descriptor,
  };
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
