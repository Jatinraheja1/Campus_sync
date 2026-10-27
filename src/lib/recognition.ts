import type { RawFace } from "./face";

/** Face MATCHING (separate from detection): compares a face descriptor with enrolled students' descriptors. */
export interface RecognitionSettings {
  threshold: number; // max Euclidean distance for a confident match (face-api commonly uses 0.6; 0.5 is stricter)
  weakMargin: number; // distances in (threshold, threshold+weakMargin] are "weak" => Needs Review
  ambiguityGap: number; // if 2nd-best is within this distance of best => ambiguous => Needs Review
  minFaceSize: number; // px, smaller side of the detected box
  minDetectionScore: number;
  minSharpness: number;
}

export const DEFAULT_SETTINGS: RecognitionSettings = {
  threshold: 0.5,
  weakMargin: 0.08,
  ambiguityGap: 0.06,
  minFaceSize: 60,
  minDetectionScore: 0.7,
  minSharpness: 20,
};

export type FaceStatus = "matched" | "review" | "unrecognized";
export interface Candidate { studentId: string; distance: number }
export interface PreparedFace extends RawFace { sharpness: number; thumb: string }
export interface ClassifiedFace extends PreparedFace {
  status: FaceStatus;
  reason: string;
  candidates: Candidate[]; // closest enrolled students, best first
}
export interface EnrolledDescriptors { studentId: string; descriptors: number[][] }

export function distance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

/** Display-only match score (1 - distance). It is NOT a probability. */
export const matchScore = (d: number) => Math.max(0, Math.min(1, 1 - d));

export function classify(faces: PreparedFace[], enrolled: EnrolledDescriptors[], s: RecognitionSettings): ClassifiedFace[] {
  const out: ClassifiedFace[] = faces.map((f) => {
    const candidates = enrolled
      .map((e) => ({ studentId: e.studentId, distance: Math.min(...e.descriptors.map((d) => distance(f.descriptor, d))) }))
      .filter((c) => Number.isFinite(c.distance))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);
    const base = { ...f, candidates };

    const issues: string[] = [];
    if (Math.min(f.box.w, f.box.h) < s.minFaceSize) issues.push("face too small");
    if (f.score < s.minDetectionScore) issues.push("low detection confidence (partly hidden or unclear)");
    if (f.sharpness < s.minSharpness) issues.push("blurry");

    const best = candidates[0];
    if (!best) return { ...base, status: "unrecognized" as const, reason: "No enrolled student to compare with" };
    if (best.distance > s.threshold + s.weakMargin) return { ...base, status: "unrecognized" as const, reason: "No enrolled student is close enough" };
    if (issues.length) return { ...base, status: "review" as const, reason: `Quality: ${issues.join(", ")}` };
    if (best.distance > s.threshold) return { ...base, status: "review" as const, reason: "Weak match" };
    const second = candidates[1];
    if (second && second.distance <= s.threshold + s.weakMargin && second.distance - best.distance < s.ambiguityGap) {
      return { ...base, status: "review" as const, reason: "Ambiguous: two students look similarly likely" };
    }
    return { ...base, status: "matched" as const, reason: "Confident match" };
  });

  // The same student must not be matched by two faces in one photo: keep the closest, send the rest to review.
  const bestByStudent = new Map<string, number>();
  out.forEach((f, i) => {
    if (f.status !== "matched") return;
    const sid = f.candidates[0].studentId;
    const j = bestByStudent.get(sid);
    if (j === undefined || f.candidates[0].distance < out[j].candidates[0].distance) bestByStudent.set(sid, i);
  });
  out.forEach((f, i) => {
    if (f.status === "matched" && bestByStudent.get(f.candidates[0].studentId) !== i) {
      f.status = "review";
      f.reason = "Same student matched by more than one face";
    }
  });
  return out;
}
