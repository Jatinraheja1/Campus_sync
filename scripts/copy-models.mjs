// Copies the face-api model weights from node_modules into public/models so the app serves
// them locally (no CDN) and they keep working offline.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";

const src = "node_modules/@vladmandic/face-api/model";
const dst = "public/models";
const needed = ["ssd_mobilenetv1_model", "face_landmark_68_model", "face_recognition_model"];

if (!existsSync(src)) {
  console.warn("[copy-models] " + src + " not found. Run `npm install` first.");
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (needed.some((p) => f.startsWith(p))) { cpSync(src + "/" + f, dst + "/" + f); n++; }
}
console.log("[copy-models] copied " + n + " model files to " + dst);
