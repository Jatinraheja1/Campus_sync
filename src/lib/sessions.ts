import type { AnalyticsSettings, AttendanceRecord, ClassSession } from "../types";
import { makeSessionId, rosterFor } from "./analytics";
import { CLASSES, CLASS_GROUP, SECTIONS, STUDENTS, TEACHERS } from "./users";
import { todayLocal } from "./utils";

export function newSession(section: string, subjectId: string, date: string): ClassSession {
  return {
    id: makeSessionId(section, subjectId, date), classGroup: CLASS_GROUP, section, subjectId, date,
    status: "scheduled", syncStatus: "Pending Sync", createdAt: new Date().toISOString(),
  };
}

/**
 * Sessions for records saved by an older version (no sessions existed). A session is treated as finalized only if
 * every student in that section has a record; otherwise it stays an unfinalized draft and is NOT counted.
 */
export function deriveSessions(records: AttendanceRecord[]): ClassSession[] {
  const groups = new Map<string, AttendanceRecord[]>();
  for (const r of records) groups.set(r.sessionId, [...(groups.get(r.sessionId) ?? []), r]);
  const out: ClassSession[] = [];
  for (const [id, recs] of groups) {
    const first = recs[0];
    const roster = STUDENTS.filter((s) => s.section === first.section);
    const complete = roster.length > 0 && roster.every((s) => recs.some((r) => r.studentId === s.id));
    const earliest = recs.map((r) => r.timestamp).sort()[0] ?? new Date().toISOString();
    out.push({
      id, classGroup: first.classGroup, section: first.section, subjectId: first.classId, date: first.date,
      status: complete ? "finalized" : "scheduled",
      syncStatus: recs.every((r) => r.status === "Synced") ? "Synced" : "Pending Sync",
      createdAt: earliest,
      ...(complete ? { finalizedAt: earliest, finalizedBy: "Migrated from an earlier version" } : {}),
    });
  }
  return out;
}

const OFFSETS = [1, 4, 8, 11, 15, 18, 22, 25]; // days ago for the first subject; later subjects shift by one day
const PRESENT_RATE: Record<string, number> = { STU001: 92, STU002: 78, STU003: 68, STU004: 85 };

/**
 * Demo history so dashboards are not empty. These are ordinary session + attendance records (all Synced);
 * every percentage shown in the UI is computed from them, nothing is stored as a percentage.
 */
export function seedSessionsAndRecords(now: Date, settings: AnalyticsSettings): { sessions: ClassSession[]; records: AttendanceRecord[] } {
  const sessions: ClassSession[] = [];
  const records: AttendanceRecord[] = [];
  CLASSES.forEach((cls, ci) => {
    const teacher = TEACHERS.find((t) => t.id === cls.teacherId)!;
    SECTIONS.forEach((section, si) => {
      OFFSETS.forEach((off, oi) => {
        const day = new Date(now.getTime() - (off + ci) * 86400000);
        day.setHours(10, 0, 0, 0);
        const date = todayLocal(day);
        const id = makeSessionId(section, cls.id, date);
        const cancelled = ci === 1 && si === 0 && oi === 1; // one cancelled class, to show it is excluded
        sessions.push({
          id, classGroup: CLASS_GROUP, section, subjectId: cls.id, date,
          status: cancelled ? "cancelled" : "finalized", syncStatus: "Synced", createdAt: day.toISOString(),
          ...(cancelled ? { cancelledAt: day.toISOString() } : { finalizedAt: day.toISOString(), finalizedBy: teacher.name }),
        });
        if (cancelled) return;
        rosterFor(STUDENTS, section, date, settings).forEach((s, k) => {
          const present = (oi * 37 + ci * 53 + STUDENTS.indexOf(s) * 29 + 17) % 100 < (PRESENT_RATE[s.id] ?? 80);
          records.push({
            id: `ATT-SAMPLE-${id}-${s.id}`, studentId: s.id, studentName: s.name, classId: cls.id, className: cls.name,
            classGroup: CLASS_GROUP, section, date, timestamp: new Date(day.getTime() + k * 60000).toISOString(),
            markedBy: teacher.name, attendance: present ? "Present" : "Absent", source: "manual", status: "Synced", sessionId: id,
          });
        });
      });
    });
  });
  return { sessions, records };
}
