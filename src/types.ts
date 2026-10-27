export type Role = "student" | "teacher" | "admin";
export type SyncStatus = "Pending Sync" | "Synced" | "Sync Failed";
export type AttendanceValue = "Present" | "Absent";
export type RecordSource = "manual" | "face";

/** One shared attendance model used by every dashboard. */
export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  classId: string; // subject / course code
  className: string; // subject name
  classGroup: string;
  section: string;
  date: string; // attendance date, YYYY-MM-DD
  timestamp: string; // when it was recorded (ISO)
  markedBy: string; // teacher name
  attendance: AttendanceValue; // Present, or Absent only when a teacher confirmed it
  source: RecordSource; // "face" = proposed by face match and confirmed by teacher
  matchScore?: number; // 1 - distance, only for face-assisted records
  status: SyncStatus;
  sessionId: string; // stable id of the class session this record belongs to
}

export type SessionStatus = "scheduled" | "finalized" | "cancelled";

/** One class meeting for a section + subject + date. Id is deterministic, so retries and other devices never duplicate it. */
export interface ClassSession {
  id: string; // SES-{section}-{subjectId}-{date}
  classGroup: string;
  section: string;
  subjectId: string;
  date: string; // YYYY-MM-DD
  status: SessionStatus;
  syncStatus: SyncStatus; // only meaningful once finalized or cancelled
  createdAt: string;
  finalizedAt?: string;
  finalizedBy?: string;
  cancelledAt?: string;
}

/** Administrator-configurable analytics settings. Nothing here is assumed: null means "not configured". */
export interface AnalyticsSettings {
  thresholdPct: number | null; // minimum attendance %, null = none configured
  semesterStart: string | null;
  semesterEnd: string | null;
  enrolledOn: Record<string, string>; // studentId -> date the student joined (absent = from the beginning)
}

export interface Notice {
  kind: "success" | "error" | "info";
  text: string;
}

export interface Account {
  id: string;
  role: Role;
  name: string;
  email: string;
  passwordHash: string;
}

export interface Student { id: string; name: string; email: string; section: string; classGroup?: string }
export interface Teacher { id: string; name: string; email: string; classIds: string[] }
export interface ClassInfo { id: string; name: string; teacherId: string; classGroup?: string }
