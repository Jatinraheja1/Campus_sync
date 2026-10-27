import type { AttendanceRecord, ClassSession, SyncStatus } from "../types";
import { dedupeRecords, dedupeSessions, makeSessionId } from "./analytics";
import { loadSettings } from "./analyticsSettings";
import { deriveSessions, seedSessionsAndRecords } from "./sessions";
import { CLASS_GROUP, STUDENTS } from "./users";

export const STATE_KEY = "smartattend.attendance.v3"; // { version: 3, records, sessions }
const LEGACY_KEY = "smartattend.records.v2"; // records only (before class sessions existed)

export interface AttendanceState { records: AttendanceRecord[]; sessions: ClassSession[] }

/** Fills fields that older saved records did not have. Duplicate (student + session) records are dropped. */
export function normalizeRecords(list: unknown[]): AttendanceRecord[] {
  return dedupeRecords(list.map((x) => {
    const r = x as Partial<AttendanceRecord>;
    const student = STUDENTS.find((s) => s.id === r.studentId);
    const section = r.section ?? student?.section ?? "A";
    return {
      ...(r as AttendanceRecord),
      classGroup: r.classGroup ?? CLASS_GROUP,
      section,
      attendance: r.attendance ?? "Present",
      source: r.source ?? "manual",
      sessionId: r.sessionId ?? makeSessionId(section, String(r.classId), String(r.date)),
    };
  }));
}

const SYNC: SyncStatus[] = ["Pending Sync", "Synced", "Sync Failed"];
export function normalizeSessions(list: unknown[]): ClassSession[] {
  const ok = list.filter((x): x is ClassSession => {
    const s = x as Partial<ClassSession> | null;
    return !!s && typeof s.id === "string" && typeof s.section === "string" && typeof s.subjectId === "string" && typeof s.date === "string"
      && (s.status === "scheduled" || s.status === "finalized" || s.status === "cancelled");
  });
  return dedupeSessions(ok.map((s) => ({ ...s, classGroup: s.classGroup ?? CLASS_GROUP, syncStatus: SYNC.includes(s.syncStatus) ? s.syncStatus : "Pending Sync" })));
}

export function parseState(raw: string): AttendanceState {
  const p = JSON.parse(raw) as { records?: unknown; sessions?: unknown };
  if (!Array.isArray(p.records) || !Array.isArray(p.sessions)) throw new Error("bad data");
  return { records: normalizeRecords(p.records), sessions: normalizeSessions(p.sessions) };
}

export function seedState(now = new Date()): AttendanceState {
  return seedSessionsAndRecords(now, loadSettings());
}

export function loadState(): { state: AttendanceState; error: string | null } {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw !== null) return { state: parseState(raw), error: null };
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy !== null) {
      const parsed: unknown = JSON.parse(legacy);
      if (!Array.isArray(parsed)) throw new Error("bad data");
      const records = normalizeRecords(parsed);
      return { state: { records, sessions: deriveSessions(records) }, error: null };
    }
    return { state: seedState(), error: null };
  } catch {
    return { state: { records: [], sessions: [] }, error: "Saved attendance could not be read from this browser. Starting with an empty list." };
  }
}

export function saveState(state: AttendanceState): string | null {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ version: 3, ...state }));
    return null;
  } catch {
    return "Attendance could not be saved to this browser (storage full or blocked). Records will be lost on refresh.";
  }
}
