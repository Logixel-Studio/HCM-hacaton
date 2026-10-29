/// <reference lib="webworker" />
// Face detection in a background thread, so the page never freezes while TF.js waits on the GPU.
// The page sends small ImageBitmap frames; this worker answers with landmarks maths and descriptors.
import * as faceapi from "@vladmandic/face-api";
import { frameFromLandmarks } from "@/lib/face-math";

type Req = { type: "init"; origin: string } | { type: "detect"; id: number; frame: ImageBitmap; withDescriptor: boolean };
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let ready: Promise<string> | null = null;
let tinyMisses = 0;

// face-api only knows "browser" (window + document) and "node". Inside a worker neither exists,
// so we give it a worker environment built on OffscreenCanvas.
const off = () => new OffscreenCanvas(1, 1);
let setupError: string | null = null;
try {
(faceapi.env as unknown as { setEnv: (e: unknown) => void }).setEnv({
  Canvas: OffscreenCanvas,
  CanvasRenderingContext2D: OffscreenCanvasRenderingContext2D,
  Image: OffscreenCanvas,
  ImageData,
  Video: OffscreenCanvas,
  createCanvasElement: off,
  createImageElement: off,
  createVideoElement: off,
  fetch: self.fetch.bind(self),
  readFile: () => { throw new Error("readFile is not available in a worker"); },
});
} catch (e) { setupError = (e as Error).message; }

async function init(origin: string) {
  if (setupError) throw new Error(setupError);
  const tf = faceapi.tf as unknown as { setBackend: (b: string) => Promise<boolean>; ready: () => Promise<void>; getBackend: () => string };
  const okGl = await tf.setBackend("webgl").catch(() => false);
  if (!okGl) await tf.setBackend("cpu");
  await tf.ready();
  const url = origin + "/models";
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(url),
    faceapi.nets.ssdMobilenetv1.loadFromUri(url),
    faceapi.nets.faceLandmark68Net.loadFromUri(url),
    faceapi.nets.faceRecognitionNet.loadFromUri(url),
  ]);
  // Warm-up: compile every network's shaders now, not during the live scan.
  const blank = faceapi.tf.zeros([160, 160, 3]) as unknown as faceapi.tf.Tensor3D;
  try {
    await faceapi.detectAllFaces(blank, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }));
    await faceapi.detectAllFaces(blank, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }));
    await faceapi.detectFaceLandmarks(blank);
    await faceapi.computeFaceDescriptor(blank);
  } catch { /* blank input: no face expected */ }
  blank.dispose();
  return tf.getBackend();
}

async function detect(frame: ImageBitmap, withDescriptor: boolean) {
  const w = frame.width, h = frame.height;
  const input = faceapi.tf.browser.fromPixels(frame) as unknown as faceapi.tf.Tensor3D;
  frame.close();
  try {
    const useSsd = tinyMisses >= 3;
    const opts = useSsd
      ? new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 3 })
      : new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 });
    const all = withDescriptor
      ? await faceapi.detectAllFaces(input, opts).withFaceLandmarks().withFaceDescriptors()
      : await faceapi.detectAllFaces(input, opts).withFaceLandmarks();
    if (useSsd) tinyMisses = 0; else tinyMisses = all.length ? 0 : tinyMisses + 1;
    if (all.length === 0) return null;
    if (all.length > 1) return "many" as const;
    const f = all[0] as (typeof all)[number] & { descriptor?: Float32Array };
    return frameFromLandmarks(f.landmarks.positions, f.detection.box, w, h, f.detection.score, f.descriptor);
  } finally {
    input.dispose();
  }
}

ctx.onmessage = async (e: MessageEvent<Req>) => {
  const m = e.data;
  if (m.type === "init") {
    if (!ready) ready = init(m.origin);
    try { ctx.postMessage({ type: "ready", backend: await ready }); }
    catch (err) { ready = null; ctx.postMessage({ type: "error", message: (err as Error).message }); }
    return;
  }
  if (m.type === "detect") {
    try {
      await ready;
      const result = await detect(m.frame, m.withDescriptor);
      ctx.postMessage({ type: "result", id: m.id, result });
    } catch (err) {
      ctx.postMessage({ type: "result", id: m.id, error: (err as Error).message });
    }
  }
};
