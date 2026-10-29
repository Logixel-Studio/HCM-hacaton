// Pure maths shared by the main thread and the face worker (no DOM, no TF.js).
export type P = { x: number; y: number };
export type FaceFrame = {
  yaw: number;        // nose position along the eye line: ≈0.5 facing the camera, lower/higher when turned
  ear: number;        // eye aspect ratio (open ≈0.3, closed ≈0.1)
  size: number;       // face width ÷ frame width
  score: number;      // detector confidence
  centre: { x: number; y: number }; // face centre, 0..1
  descriptor?: Float32Array;
};

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const eyeRatio = (e: P[]) => (dist(e[1], e[5]) + dist(e[2], e[4])) / (2 * Math.max(1, dist(e[0], e[3])));

/** Turns 68 landmarks + the face box into the numbers the liveness steps use. */
export function frameFromLandmarks(p: P[], box: { x: number; y: number; width: number; height: number }, w: number, h: number, score: number, descriptor?: Float32Array): FaceFrame {
  const l = p[36], r = p[45], nose = p[30];
  const ex = r.x - l.x, ey = r.y - l.y;
  const yaw = ((nose.x - l.x) * ex + (nose.y - l.y) * ey) / Math.max(1, ex * ex + ey * ey); // robust to head tilt
  const ear = (eyeRatio(p.slice(36, 42)) + eyeRatio(p.slice(42, 48))) / 2;
  return {
    yaw, ear, size: box.width / w, score,
    centre: { x: (box.x + box.width / 2) / w, y: (box.y + box.height / 2) / h },
    descriptor,
  };
}
