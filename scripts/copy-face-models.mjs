// Copies the face-recognition model weights shipped with @vladmandic/face-api into /public/models,
// so the browser loads them from your own domain (no CDN needed).
import fs from "fs"; import path from "path";
const src = path.resolve("node_modules/@vladmandic/face-api/model");
const dst = path.resolve("public/models");
const keep = ["tiny_face_detector_model", "ssd_mobilenetv1_model", "face_landmark_68_model", "face_recognition_model"];
if (!fs.existsSync(src)) process.exit(0);
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) if (keep.some((k) => f.startsWith(k))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log("face models copied to public/models");
