import type { AnalyticsSettings, AttendanceRecord, ClassSession } from "../types";

/**
 * Pure attendance-analytics rules. No React, no storage, no hardcoded values.
 *
 * A session is CONFIRMED (counts as a class conducted) only when ALL are true:
 *   - status is "finalized" (scheduled drafts and cancelled sessions never count)
 *   - the session itself is Synced
 *   - every attendance record of that session is Synced (pending/failed = unconfirmed)
 * A student attended a confirmed session only with a Present record; Absent record = missed.
 */

export interface SubjectRef { id: string; name: string }
export interface StudentRef { id: string; name: string; section: string }
export interface AnalyticsData { sessions: ClassSession[]; records: AttendanceRecord[]; settings: AnalyticsSettings }
export interface AttendanceFilter { subjectId: string | null; from: string | null; to: string | null; semester: boolean }
export const NO_FILTER: AttendanceFilter = { subjectId: null, from: null, to: null, semester: false };

export const makeSessionId = (section: string, subjectId: string, date: string) => `SES-${section}-${subjectId}-${date}`;

/** (attended x 100) / conducted, or null when nothing was conducted (never divides by zero). */
export function pct(attended: number, conducted: number): number | null {
  return conducted > 0 ? (attended * 100) / conducted : null;
}
export const formatPct = (p: number | null): string => (p === null ? "—" : `${p.toFixed(2)}%`);

export type ThresholdStatus = "no-data" | "no-threshold" | "below" | "meets";
/** Compared on the value as displayed (2 decimals) so a card never says "75.00%" and "below 75%". */
export function thresholdStatus(p: number | null, threshold: number | null): ThresholdStatus {
  if (p === null) return "no-data";
  if (threshold === null) return "no-threshold";
  return Math.round(p * 100) / 100 < threshold ? "below" : "meets";
}

export function dedupeSessions(sessions: ClassSession[]): ClassSession[] {
  const seen = new Set<string>();
  return sessions.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}
export function dedupeRecords(records: AttendanceRecord[]): AttendanceRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const k = `${r.studentId}|${r.sessionId}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

export function rosterFor<T extends StudentRef & { id: string }>(students: T[], section: string, date: string, settings: AnalyticsSettings): T[] {
  return students.filter((s) => s.section === section && (!settings.enrolledOn[s.id] || settings.enrolledOn[s.id] <= date));
}

interface Index {
  sessions: ClassSession[];
  recs: Map<string, Map<string, AttendanceRecord>>; // sessionId -> studentId -> record
  confirmed: Set<string>;
}
function buildIndex(data: AnalyticsData): Index {
  const sessions = dedupeSessions(data.sessions);
  const recs = new Map<string, Map<string, AttendanceRecord>>();
  for (const r of dedupeRecords(data.records)) {
    if (!recs.has(r.sessionId)) recs.set(r.sessionId, new Map());
    recs.get(r.sessionId)!.set(r.studentId, r);
  }
  const confirmed = new Set<string>();
  for (const s of sessions) if (sessionConfirmed(s, [...(recs.get(s.id)?.values() ?? [])])) confirmed.add(s.id);
  return { sessions, recs, confirmed };
}

export function sessionConfirmed(s: ClassSession, records: AttendanceRecord[]): boolean {
  return s.status === "finalized" && s.syncStatus === "Synced" && records.length > 0 && records.every((r) => r.status === "Synced");
}

export function resolveRange(f: AttendanceFilter, settings: AnalyticsSettings): { from: string | null; to: string | null } {
  let { from, to } = f;
  if (f.semester) {
    if (settings.semesterStart && (!from || settings.semesterStart > from)) from = settings.semesterStart;
    if (settings.semesterEnd && (!to || settings.semesterEnd < to)) to = settings.semesterEnd;
  }
  return { from, to };
}
const inRange = (d: string, r: { from: string | null; to: string | null }) => (!r.from || d >= r.from) && (!r.to || d <= r.to);

export interface SubjectStats {
  subjectId: string; subjectName: string;
  conducted: number; attended: number; missed: number;
  unrecorded: number; // confirmed sessions with no record for this student (data problem, shown, never guessed)
  percentage: number | null;
}
export interface StudentStats {
  overall: { conducted: number; attended: number; missed: number; unrecorded: number; subjects: number; percentage: number | null };
  bySubject: SubjectStats[];
}

export function computeStudentStats(student: StudentRef, subjects: SubjectRef[], data: AnalyticsData, filter: AttendanceFilter): StudentStats {
  const ix = buildIndex(data);
  const range = resolveRange(filter, data.settings);
  const joined = data.settings.enrolledOn[student.id] ?? null;
  const subs = filter.subjectId ? subjects.filter((s) => s.id === filter.subjectId) : subjects;
  const bySubject = subs.map<SubjectStats>((sub) => {
    let conducted = 0, attended = 0, missed = 0;
    for (const s of ix.sessions) {
      if (s.section !== student.section || s.subjectId !== sub.id || !ix.confirmed.has(s.id)) continue;
      if (!inRange(s.date, range) || (joined && s.date < joined)) continue;
      conducted++;
      const r = ix.recs.get(s.id)?.get(student.id);
      if (r?.attendance === "Present") attended++;
      else if (r?.attendance === "Absent") missed++;
    }
    return { subjectId: sub.id, subjectName: sub.name, conducted, attended, missed, unrecorded: conducted - attended - missed, percentage: pct(attended, conducted) };
  });
  // Weighted: sum attended / sum conducted. NOT the average of subject percentages.
  const sum = (k: "conducted" | "attended" | "missed" | "unrecorded") => bySubject.reduce((a, b) => a + b[k], 0);
  const conducted = sum("conducted"), attended = sum("attended");
  return { overall: { conducted, attended, missed: sum("missed"), unrecorded: sum("unrecorded"), subjects: subs.length, percentage: pct(attended, conducted) }, bySubject };
}

export type HistoryState = "present" | "absent" | "pending" | "unrecorded" | "cancelled";
export interface HistoryRow { sessionId: string; date: string; subjectId: string; subjectName: string; state: HistoryState; note?: string }

export function buildHistory(student: StudentRef, subjects: SubjectRef[], data: AnalyticsData, filter: AttendanceFilter): HistoryRow[] {
  const ix = buildIndex(data);
  const range = resolveRange(filter, data.settings);
  const joined = data.settings.enrolledOn[student.id] ?? null;
  const rows: HistoryRow[] = [];
  for (const s of ix.sessions) {
    if (s.section !== student.section || (filter.subjectId && s.subjectId !== filter.subjectId)) continue;
    if (!inRange(s.date, range) || (joined && s.date < joined)) continue;
    const name = subjects.find((x) => x.id === s.subjectId)?.name ?? s.subjectId;
    const base = { sessionId: s.id, date: s.date, subjectId: s.subjectId, subjectName: name };
    const r = ix.recs.get(s.id)?.get(student.id);
    if (s.status === "cancelled") rows.push({ ...base, state: "cancelled", note: "Class cancelled. Not counted." });
    else if (s.status === "scheduled") { if (r) rows.push({ ...base, state: "pending", note: "Recorded, but the teacher has not finalized this class yet." }); }
    else if (ix.confirmed.has(s.id)) rows.push({ ...base, state: r ? (r.attendance === "Present" ? "present" : "absent") : "unrecorded", note: r ? undefined : "No attendance was recorded for you in this class." });
    else rows.push({ ...base, state: "pending", note: "Waiting for synchronization. Not counted yet." });
  }
  return rows.sort((a, b) => (a.date === b.date ? a.subjectName.localeCompare(b.subjectName) : a.date < b.date ? 1 : -1));
}

export interface SessionCounts { conducted: number; pendingSync: number; drafts: number; cancelled: number }
export function sessionCounts(section: string, subjectId: string, data: AnalyticsData, filter: AttendanceFilter = NO_FILTER): SessionCounts {
  const ix = buildIndex(data);
  const range = resolveRange(filter, data.settings);
  const c: SessionCounts = { conducted: 0, pendingSync: 0, drafts: 0, cancelled: 0 };
  for (const s of ix.sessions) {
    if (s.section !== section || s.subjectId !== subjectId || !inRange(s.date, range)) continue;
    if (s.status === "cancelled") c.cancelled++;
    else if (s.status === "scheduled") c.drafts++;
    else if (ix.confirmed.has(s.id)) c.conducted++;
    else c.pendingSync++;
  }
  return c;
}

export interface SectionSubjectStats { subjectId: string; subjectName: string; sessions: number; attended: number; possible: number; percentage: number | null }
export interface SectionStats {
  section: string;
  students: { student: StudentRef; stats: StudentStats }[];
  sessions: number; attended: number; possible: number; percentage: number | null;
  bySubject: SectionSubjectStats[];
}

export function computeSectionStats(section: string, students: StudentRef[], subjects: SubjectRef[], data: AnalyticsData, filter: AttendanceFilter): SectionStats {
  const rows = students.filter((s) => s.section === section).map((student) => ({ student, stats: computeStudentStats(student, subjects, data, filter) }));
  const subs = filter.subjectId ? subjects.filter((s) => s.id === filter.subjectId) : subjects;
  const bySubject = subs.map<SectionSubjectStats>((sub) => {
    const attended = rows.reduce((a, r) => a + (r.stats.bySubject.find((b) => b.subjectId === sub.id)?.attended ?? 0), 0);
    const possible = rows.reduce((a, r) => a + (r.stats.bySubject.find((b) => b.subjectId === sub.id)?.conducted ?? 0), 0);
    return { subjectId: sub.id, subjectName: sub.name, sessions: sessionCounts(section, sub.id, data, filter).conducted, attended, possible, percentage: pct(attended, possible) };
  });
  const attended = bySubject.reduce((a, b) => a + b.attended, 0);
  const possible = bySubject.reduce((a, b) => a + b.possible, 0);
  return { section, students: rows, sessions: bySubject.reduce((a, b) => a + b.sessions, 0), attended, possible, percentage: pct(attended, possible), bySubject };
}

/** Can the teacher finalize this session? Every enrolled student must have a confirmed Present/Absent decision. */
export function finalizeCheck(session: ClassSession | undefined, records: AttendanceRecord[], roster: StudentRef[]): { ok: boolean; reason?: string; missing: StudentRef[] } {
  if (!session) return { ok: false, reason: "No attendance has been recorded for this class yet.", missing: roster };
  if (session.status === "finalized") return { ok: false, reason: "This class session is already finalized.", missing: [] };
  if (session.status === "cancelled") return { ok: false, reason: "This class session was cancelled.", missing: [] };
  const have = new Set(records.filter((r) => r.sessionId === session.id).map((r) => r.studentId));
  const missing = roster.filter((s) => !have.has(s.id));
  if (roster.length === 0) return { ok: false, reason: "No enrolled students for this section on this date.", missing };
  if (missing.length) return { ok: false, reason: `Mark every student Present or Absent first. Missing: ${missing.map((m) => m.name).join(", ")}.`, missing };
  return { ok: true, missing: [] };
}
