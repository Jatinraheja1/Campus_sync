import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_FILTER, buildHistory, computeSectionStats, computeStudentStats, finalizeCheck, formatPct, makeSessionId, pct, sessionCounts, thresholdStatus,
} from "../src/lib/analytics.ts";
import type { AnalyticsSettings, AttendanceRecord, ClassSession, SyncStatus } from "../src/types.ts";

const settings: AnalyticsSettings = { thresholdPct: null, semesterStart: null, semesterEnd: null, enrolledOn: {} };
const A = { id: "S1", name: "Asha", section: "A" };
const B = { id: "S2", name: "Bela", section: "A" };
const subjects = [{ id: "X", name: "Subject X" }, { id: "Y", name: "Subject Y" }];

let n = 0;
function session(subjectId: string, date: string, over: Partial<ClassSession> = {}): ClassSession {
  return { id: makeSessionId("A", subjectId, date), classGroup: "g", section: "A", subjectId, date, status: "finalized", syncStatus: "Synced", createdAt: "", ...over };
}
function rec(studentId: string, s: ClassSession, attendance: "Present" | "Absent", status: SyncStatus = "Synced"): AttendanceRecord {
  return { id: `R${n++}`, studentId, studentName: studentId, classId: s.subjectId, className: s.subjectId, classGroup: "g", section: "A", date: s.date, timestamp: "", markedBy: "t", attendance, source: "manual", status, sessionId: s.id };
}
/** subject with `total` sessions, student present in first `present` of them */
function build(subjectId: string, total: number, present: number, studentId = "S1") {
  const sessions: ClassSession[] = []; const records: AttendanceRecord[] = [];
  for (let i = 0; i < total; i++) {
    const s = session(subjectId, `2026-09-${String(i + 1).padStart(2, "0")}`);
    sessions.push(s); records.push(rec(studentId, s, i < present ? "Present" : "Absent"));
  }
  return { sessions, records };
}
const data = (...parts: { sessions: ClassSession[]; records: AttendanceRecord[] }[]) => ({
  sessions: parts.flatMap((p) => p.sessions), records: parts.flatMap((p) => p.records), settings,
});

test("overall percentage is correct (72 of 90 = 80%)", () => {
  const st = computeStudentStats(A, subjects, data(build("X", 90, 72)), NO_FILTER);
  assert.equal(st.overall.attended, 72); assert.equal(st.overall.conducted, 90); assert.equal(st.overall.missed, 18);
  assert.equal(formatPct(st.overall.percentage), "80.00%");
});

test("subject percentages are independent", () => {
  const st = computeStudentStats(A, subjects, data(build("X", 30, 25), build("Y", 20, 14)), NO_FILTER);
  assert.equal(formatPct(st.bySubject[0].percentage), "83.33%");
  assert.equal(formatPct(st.bySubject[1].percentage), "70.00%");
});

test("overall is weighted by classes, not the average of subject percentages", () => {
  const st = computeStudentStats(A, subjects, data(build("X", 10, 9), build("Y", 30, 20)), NO_FILTER);
  assert.equal(st.overall.percentage, 72.5);            // (9+20)/(10+30)
  assert.notEqual(st.overall.percentage, (90 + 200 / 3) / 2);
});

test("cancelled and not-finalized sessions are excluded", () => {
  const p = build("X", 4, 4);
  p.sessions[0].status = "cancelled"; p.sessions[1].status = "scheduled";
  const st = computeStudentStats(A, subjects, data(p), NO_FILTER);
  assert.equal(st.overall.conducted, 2);
});

test("pending / failed records make the whole session unconfirmed (not counted as attended or missed)", () => {
  const p = build("X", 3, 3);
  p.records[2].status = "Pending Sync";
  let st = computeStudentStats(A, subjects, data(p), NO_FILTER);
  assert.equal(st.overall.conducted, 2); assert.equal(st.overall.attended, 2);
  p.records[2].status = "Sync Failed";
  st = computeStudentStats(A, subjects, data(p), NO_FILTER);
  assert.equal(st.overall.conducted, 2);
  const p2 = build("X", 2, 2); p2.sessions[0].syncStatus = "Pending Sync";
  assert.equal(computeStudentStats(A, subjects, data(p2), NO_FILTER).overall.conducted, 1);
  assert.equal(sessionCounts("A", "X", data(p2)).pendingSync, 1);
});

test("repeated sync (duplicate sessions / records) does not double-count", () => {
  const p = build("X", 5, 4);
  const d = data(p, { sessions: [...p.sessions], records: [...p.records] }); // everything delivered twice
  const st = computeStudentStats(A, subjects, d, NO_FILTER);
  assert.equal(st.overall.conducted, 5); assert.equal(st.overall.attended, 4);
  assert.equal(sessionCounts("A", "X", d).conducted, 5);
});

test("students only see their own records; other students do not leak in", () => {
  const d = data(build("X", 4, 4, "S1"), build("X", 4, 0, "S2"));
  // build() above creates the same session ids twice, so S2's records attach to the same sessions
  const mine = computeStudentStats(A, subjects, { ...d, sessions: d.sessions }, NO_FILTER);
  assert.equal(mine.overall.attended, 4);
  const other = computeStudentStats(B, subjects, d, NO_FILTER);
  assert.equal(other.overall.attended, 0);
  const rows = buildHistory(A, subjects, d, NO_FILTER);
  assert.ok(rows.every((r) => r.state === "present"));
});

test("filters update counts: subject and date range", () => {
  const d = data(build("X", 10, 10), build("Y", 10, 5));
  assert.equal(computeStudentStats(A, subjects, d, { ...NO_FILTER, subjectId: "Y" }).overall.conducted, 10);
  const ranged = computeStudentStats(A, subjects, d, { ...NO_FILTER, from: "2026-09-03", to: "2026-09-05" });
  assert.equal(ranged.overall.conducted, 6);   // 3 days x 2 subjects
  assert.equal(buildHistory(A, subjects, d, { ...NO_FILTER, from: "2026-09-03", to: "2026-09-05", subjectId: "X" }).length, 3);
  const sem = { ...d, settings: { ...settings, semesterStart: "2026-09-09", semesterEnd: "2026-09-20" } };
  assert.equal(computeStudentStats(A, subjects, sem, { ...NO_FILTER, semester: true }).overall.conducted, 4);
});

test("zero classes: no division by zero", () => {
  assert.equal(pct(0, 0), null);
  const st = computeStudentStats(A, subjects, data(), NO_FILTER);
  assert.equal(st.overall.percentage, null); assert.equal(formatPct(st.overall.percentage), "—");
  assert.ok(st.bySubject.every((s) => s.percentage === null));
  assert.equal(thresholdStatus(null, 75), "no-data");
});

test("late joiners only count sessions on/after their enrollment date", () => {
  const d = { ...data(build("X", 10, 10)), settings: { ...settings, enrolledOn: { S1: "2026-09-06" } } };
  const st = computeStudentStats(A, subjects, d, NO_FILTER);
  assert.equal(st.overall.conducted, 5);
  assert.equal(buildHistory(A, subjects, d, NO_FILTER).length, 5);
});

test("threshold is never assumed", () => {
  assert.equal(thresholdStatus(50, null), "no-threshold");
  assert.equal(thresholdStatus(74.99, 75), "below");
  assert.equal(thresholdStatus(74.996, 75), "meets"); // displays as 75.00%
  assert.equal(thresholdStatus(75, 75), "meets");
});

test("section aggregates are weighted across students", () => {
  const d = data(build("X", 10, 10, "S1"), { sessions: [], records: build("X", 10, 5, "S2").records });
  const sec = computeSectionStats("A", [A, B], subjects, d, NO_FILTER);
  assert.equal(sec.attended, 15); assert.equal(sec.possible, 20); assert.equal(sec.percentage, 75);
  assert.equal(sec.bySubject[0].sessions, 10);
});

test("finalize needs every enrolled student marked; locked afterwards", () => {
  const s = session("X", "2026-09-01", { status: "scheduled", syncStatus: "Pending Sync" });
  const one = [rec("S1", s, "Present", "Pending Sync")];
  assert.equal(finalizeCheck(undefined, [], [A, B]).ok, false);
  const partial = finalizeCheck(s, one, [A, B]);
  assert.equal(partial.ok, false); assert.deepEqual(partial.missing.map((m) => m.id), ["S2"]);
  assert.equal(finalizeCheck(s, [...one, rec("S2", s, "Absent", "Pending Sync")], [A, B]).ok, true);
  assert.equal(finalizeCheck({ ...s, status: "finalized" }, one, [A]).ok, false);
});

test("session ids are deterministic (no duplicate sessions for the same class/section/subject/date)", () => {
  assert.equal(makeSessionId("A", "CS101", "2026-10-01"), makeSessionId("A", "CS101", "2026-10-01"));
  assert.notEqual(makeSessionId("A", "CS101", "2026-10-01"), makeSessionId("B", "CS101", "2026-10-01"));
});
