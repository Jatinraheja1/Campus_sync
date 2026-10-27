import type * as FaceApiNS from "@vladmandic/face-api";

type FaceApi = typeof FaceApiNS;

/** Model: SSD MobileNetV1 (detection) + 68-point landmarks (alignment) + FaceRecognitionNet (128-d descriptor). */
export const MODEL_NAME = "face-api.js SSD MobileNetV1 + FaceRecognitionNet (128-d)";
const MODEL_URL = `${import.meta.env.BASE_URL}models`;

export interface Box { x: number; y: number; w: number; h: number }
export interface RawFace { box: Box; score: number; descriptor: number[] }

let api: FaceApi | null = null;
let loading: Promise<FaceApi> | null = null;

/** Loads the TensorFlow.js runtime and the model weights from LOCAL files (/models). No cloud calls. */
export function loadFaceModels(): Promise<FaceApi> {
  if (api) return Promise.resolve(api);
  if (!loading) {
    loading = (async () => {
      const fa = await import("@vladmandic/face-api");
      // Some published face-api type bundles omit TensorFlow runtime methods that exist at runtime.
      const tfRuntime = fa.tf as typeof fa.tf & { setBackend: (backend: string) => Promise<boolean>; ready: () => Promise<void> };
      try {
        const ok = await tfRuntime.setBackend("webgl");
        if (!ok) await tfRuntime.setBackend("cpu");
      } catch {
        await tfRuntime.setBackend("cpu");
      }
      await tfRuntime.ready();
      await Promise.all([
        fa.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        fa.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        fa.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      api = fa;
      return fa;
    })().catch(() => {
      loading = null;
      throw new Error("Face models could not be loaded from /models. Run `npm install` (it copies the model files into public/models), restart the dev server, and visit the app once online if it is hosted remotely.");
    });
  }
  return loading;
}

function crop(src: HTMLCanvasElement, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  c.getContext("2d")!.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

/**
 * Face DETECTION + descriptor extraction. Large classroom photos are also scanned in four overlapping tiles
 * so small, distant faces are not lost to the detector's fixed input size. Duplicates are merged (NMS).
 */
export async function detectFaces(canvas: HTMLCanvasElement, opts: { tile: boolean; onProgress?: (s: string) => void }): Promise<RawFace[]> {
  const fa = await loadFaceModels();
  const options = new fa.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 150 });
  const W = canvas.width, H = canvas.height;
  const regions: Box[] = [{ x: 0, y: 0, w: W, h: H }];
  if (opts.tile && Math.max(W, H) >= 1000) {
    const tw = Math.round((W / 2) * 1.2), th = Math.round((H / 2) * 1.2);
    for (const r of [0, 1]) for (const c of [0, 1]) regions.push({ x: c ? W - tw : 0, y: r ? H - th : 0, w: tw, h: th });
  }

  const all: RawFace[] = [];
  for (let i = 0; i < regions.length; i++) {
    opts.onProgress?.(`Detecting and analysing faces (region ${i + 1} of ${regions.length})…`);
    const reg = regions[i];
    const input = i === 0 ? canvas : crop(canvas, reg.x, reg.y, reg.w, reg.h);
    const results = await fa.detectAllFaces(input, options).withFaceLandmarks().withFaceDescriptors();
    for (const r of results) {
      const b = r.detection.box;
      all.push({ box: { x: b.x + reg.x, y: b.y + reg.y, w: b.width, h: b.height }, score: r.detection.score, descriptor: Array.from(r.descriptor) });
    }
    await new Promise((res) => setTimeout(res, 0)); // let the UI repaint
  }

  all.sort((a, b) => b.score - a.score);
  const kept: RawFace[] = [];
  for (const f of all) if (kept.every((k) => iou(k.box, f.box) < 0.4)) kept.push(f);
  return kept;
}

/** Small preview of one face, kept only in memory for the review screen. */
export function faceThumbnail(src: HTMLCanvasElement, b: Box, size = 96): string {
  const m = Math.max(b.w, b.h) * 0.25;
  const x = Math.max(0, b.x - m), y = Math.max(0, b.y - m);
  const w = Math.min(src.width - x, b.w + 2 * m), h = Math.min(src.height - y, b.h + 2 * m);
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  c.getContext("2d")!.drawImage(src, x, y, w, h, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.8);
}

/** Variance of the Laplacian on a 64x64 grayscale face crop. Low = blurry. A rough heuristic, tune per camera. */
export function faceSharpness(src: HTMLCanvasElement, b: Box): number {
  const N = 64;
  const c = document.createElement("canvas");
  c.width = N; c.height = N;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, Math.max(0, b.x), Math.max(0, b.y), b.w, b.h, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  const g = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const l = g[(y - 1) * N + x] + g[(y + 1) * N + x] + g[y * N + x - 1] + g[y * N + x + 1] - 4 * g[y * N + x];
    sum += l; sumSq += l * l; n++;
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}
