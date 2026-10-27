import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AttendanceRecord, AttendanceValue, ClassInfo, ClassSession, Notice, RecordSource, Student, Teacher } from "../types";
import { STATE_KEY, loadState, parseState, saveState, seedState } from "../lib/storage";
import { hasBackend, uploadRecord, uploadSession } from "../lib/api";
import { finalizeCheck, makeSessionId, rosterFor } from "../lib/analytics";
import { loadSettings, saveSettings, seedSettings } from "../lib/analyticsSettings";
import { newSession } from "../lib/sessions";
import { CLASS_GROUP, STUDENTS } from "../lib/users";
import { newRecordId, todayLocal } from "../lib/utils";
import { useConnectivity } from "./ConnectivityContext";

/** Counts cover attendance records AND finalized/cancelled class sessions (both must sync). */
interface Counts { total: number; pending: number; failed: number; synced: number }

export interface NewAttendance {
  student: Student;
  cls: ClassInfo; // subject
  teacher: Teacher;
  date?: string;
  attendance?: AttendanceValue;
  source?: RecordSource;
  matchScore?: number;
}

export interface SessionRef { section: string; subjectId: string; date: string; teacher: Teacher }

interface AttendanceCtx {
  records: AttendanceRecord[];
  sessions: ClassSession[];
  counts: Counts;
  storageError: string | null;
  syncing: boolean;
  forceError: boolean;
  setForceError: (v: boolean) => void;
  syncNotice: Notice | null;
  markAttendance: (student: Student, cls: ClassInfo, teacher: Teacher, attendance?: AttendanceValue) => Notice;
  saveBatch: (items: NewAttendance[]) => { saved: number; skipped: string[]; locked: string[]; notEnrolled: string[] };
  finalizeSession: (ref: SessionRef) => Notice;
  cancelSession: (ref: SessionRef) => Notice;
  syncPending: () => Promise<void>;
  resetDemoData: () => void;
}

const Ctx = createContext<AttendanceCtx | null>(null);
const dupKey = (studentId: string, sessionId: string) => `${studentId}|${sessionId}`;
const needsSync = (s: ClassSession) => s.status !== "scheduled" && s.syncStatus !== "Synced"; // drafts are local only

export function AttendanceProvider({ children }: { children: ReactNode }) {
  const { online } = useConnectivity();
  const initial = useMemo(() => loadState(), []);
  const [records, setRecords] = useState<AttendanceRecord[]>(initial.state.records);
  const [sessions, setSessions] = useState<ClassSession[]>(initial.state.sessions);
  const [storageError, setStorageError] = useState<string | null>(initial.error);
  const [syncing, setSyncing] = useState(false);
  const [forceError, setForceError] = useState(false);
  const [syncNotice, setSyncNotice] = useState<Notice | null>(null);

  const onlineRef = useRef(online);
  const recordsRef = useRef(records);
  const sessionsRef = useRef(sessions);
  const syncingRef = useRef(false);
  const forceErrorRef = useRef(false);
  useEffect(() => { onlineRef.current = online; }, [online]);
  useEffect(() => { recordsRef.current = records; }, [records]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { forceErrorRef.current = forceError; }, [forceError]);

  useEffect(() => { setStorageError(saveState({ records, sessions })); }, [records, sessions]);

  // Keep other open tabs in step.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STATE_KEY || !e.newValue) return;
      try {
        const next = parseState(e.newValue);
        recordsRef.current = next.records; sessionsRef.current = next.sessions;
        setRecords(next.records); setSessions(next.sessions);
      } catch { /* ignore */ }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const counts = useMemo<Counts>(() => {
    const items = [...records.map((r) => r.status), ...sessions.filter((s) => s.status !== "scheduled").map((s) => s.syncStatus)];
    const synced = items.filter((x) => x === "Synced").length;
    const failed = items.filter((x) => x === "Sync Failed").length;
    const pending = items.filter((x) => x === "Pending Sync").length + failed;
    return { total: items.length, pending, failed, synced };
  }, [records, sessions]);

  const commit = (nextRecords: AttendanceRecord[], nextSessions: ClassSession[]) => {
    recordsRef.current = nextRecords; sessionsRef.current = nextSessions;
    setRecords(nextRecords); setSessions(nextSessions);
  };

  /**
   * Saves records locally as Pending Sync and creates the class session (as an unfinalized draft) on first use.
   * Duplicates (same student + session) are skipped. Finalized or cancelled sessions are locked.
   */
  const saveBatch = useCallback<AttendanceCtx["saveBatch"]>((items) => {
    const settings = loadSettings();
    const sessionMap = new Map(sessionsRef.current.map((s) => [s.id, s]));
    const existing = new Set(recordsRef.current.map((r) => dupKey(r.studentId, r.sessionId)));
    const created: AttendanceRecord[] = [];
    const newSessions: ClassSession[] = [];
    const skipped: string[] = [], locked: string[] = [], notEnrolled: string[] = [];
    for (const it of items) {
      const date = it.date ?? todayLocal();
      const joined = settings.enrolledOn[it.student.id];
      if (joined && date < joined) { notEnrolled.push(it.student.name); continue; }
      const sid = makeSessionId(it.student.section, it.cls.id, date);
      const sess = sessionMap.get(sid);
      if (sess && sess.status !== "scheduled") { locked.push(it.student.name); continue; }
      const key = dupKey(it.student.id, sid);
      if (existing.has(key)) { skipped.push(it.student.name); continue; }
      existing.add(key);
      if (!sess) { const ns = newSession(it.student.section, it.cls.id, date); sessionMap.set(sid, ns); newSessions.push(ns); }
      created.push({
        id: newRecordId(),
        studentId: it.student.id,
        studentName: it.student.name,
        classId: it.cls.id,
        className: it.cls.name,
        classGroup: it.cls.classGroup ?? it.student.classGroup ?? CLASS_GROUP,
        section: it.student.section,
        date,
        timestamp: new Date().toISOString(),
        markedBy: it.teacher.name,
        attendance: it.attendance ?? "Present",
        source: it.source ?? "manual",
        matchScore: it.matchScore,
        status: "Pending Sync",
        sessionId: sid,
      });
    }
    if (created.length || newSessions.length) commit([...created, ...recordsRef.current], [...newSessions, ...sessionsRef.current]);
    return { saved: created.length, skipped, locked, notEnrolled };
  }, []);

  const markAttendance = useCallback<AttendanceCtx["markAttendance"]>((student, cls, teacher, attendance = "Present") => {
    const res = saveBatch([{ student, cls, teacher, attendance }]);
    if (res.locked.length) return { kind: "error", text: `Today's ${cls.name} class for Section ${student.section} is already finalized or cancelled. Nothing was changed.` };
    if (res.notEnrolled.length) return { kind: "error", text: `${student.name} was not enrolled on this date. Nothing was saved.` };
    if (res.saved === 0) return { kind: "error", text: `${student.name} is already recorded for ${cls.name} today. Duplicate was not saved.` };
    return { kind: "success", text: `${student.name} marked ${attendance.toLowerCase()}. Saved on this device as Pending Sync${onlineRef.current ? "; press Sync to upload." : ". It will wait until the connection returns."}` };
  }, [saveBatch]);

  const authorised = (ref: SessionRef) => ref.teacher.classIds.includes(ref.subjectId);

  /** Finalizing is the only thing that makes a class count as conducted (and only once it has synced). Idempotent. */
  const finalizeSession = useCallback<AttendanceCtx["finalizeSession"]>((ref) => {
    if (!authorised(ref)) return { kind: "error", text: "You can only finalize classes for your own subjects." };
    const sid = makeSessionId(ref.section, ref.subjectId, ref.date);
    const sess = sessionsRef.current.find((s) => s.id === sid);
    const roster = rosterFor(STUDENTS, ref.section, ref.date, loadSettings());
    const chk = finalizeCheck(sess, recordsRef.current.filter((r) => r.sessionId === sid), roster);
    if (!chk.ok || !sess) return { kind: "error", text: chk.reason ?? "This session cannot be finalized." };
    const now = new Date().toISOString();
    commit(recordsRef.current, sessionsRef.current.map((s) => (s.id === sid ? { ...s, status: "finalized", syncStatus: "Pending Sync", finalizedAt: now, finalizedBy: ref.teacher.name } : s)));
    return { kind: "success", text: "Class session finalized and locked. It is counted in attendance analytics once it and its records are synchronized." };
  }, []);

  const cancelSession = useCallback<AttendanceCtx["cancelSession"]>((ref) => {
    if (!authorised(ref)) return { kind: "error", text: "You can only cancel classes for your own subjects." };
    const sid = makeSessionId(ref.section, ref.subjectId, ref.date);
    const sess = sessionsRef.current.find((s) => s.id === sid);
    if (sess && sess.status !== "scheduled") return { kind: "error", text: `This class session is already ${sess.status}. It cannot be cancelled.` };
    const now = new Date().toISOString();
    const cancelled: ClassSession = { ...(sess ?? newSession(ref.section, ref.subjectId, ref.date)), status: "cancelled", syncStatus: "Pending Sync", cancelledAt: now };
    commit(recordsRef.current, sess ? sessionsRef.current.map((s) => (s.id === sid ? cancelled : s)) : [cancelled, ...sessionsRef.current]);
    return { kind: "success", text: "Class session cancelled. It does not count toward attendance." };
  }, []);

  const syncPending = useCallback(async () => {
    if (syncingRef.current) return;
    if (!onlineRef.current) {
      setSyncNotice({ kind: "error", text: "Cannot sync while offline. Records stay saved on this device." });
      return;
    }
    const recIds = recordsRef.current.filter((r) => r.status !== "Synced").map((r) => r.id);
    const sesIds = sessionsRef.current.filter(needsSync).map((s) => s.id);
    if (recIds.length + sesIds.length === 0) return;

    syncingRef.current = true;
    setSyncing(true);
    setSyncNotice({ kind: "info", text: hasBackend ? "Sending saved records to the backend…" : "Syncing saved records (simulation)…" });
    let ok = 0, bad = 0, lost = false;
    try {
      for (const id of recIds) {
        if (!onlineRef.current) { lost = true; break; }
        const rec = recordsRef.current.find((r) => r.id === id);
        if (!rec) continue;
        const res = await uploadRecord(rec, { simulateFailure: forceErrorRef.current });
        recordsRef.current = recordsRef.current.map((r) => (r.id === id ? { ...r, status: res.ok ? "Synced" : "Sync Failed" } : r));
        setRecords(recordsRef.current);
        if (res.ok) ok++; else bad++;
      }
      // Sessions go last, and only when all of their records are stored, so a session is never "confirmed" ahead of its records.
      for (const id of sesIds) {
        if (lost) break;
        if (!onlineRef.current) { lost = true; break; }
        const sess = sessionsRef.current.find((s) => s.id === id);
        if (!sess || !needsSync(sess)) continue;
        if (recordsRef.current.some((r) => r.sessionId === id && r.status !== "Synced")) continue;
        const res = await uploadSession(sess, { simulateFailure: forceErrorRef.current });
        sessionsRef.current = sessionsRef.current.map((s) => (s.id === id ? { ...s, syncStatus: res.ok ? "Synced" : "Sync Failed" } : s));
        setSessions(sessionsRef.current);
        if (res.ok) ok++; else bad++;
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
    if (lost) setSyncNotice({ kind: "error", text: `Connection lost after ${ok} item(s). Remaining items are still pending.` });
    else if (bad > 0) setSyncNotice({ kind: "error", text: `${bad} item(s) failed to sync${hasBackend ? "" : " (simulated server error)"}. They stay saved locally. Press Sync to retry.` });
    else setSyncNotice({ kind: "success", text: hasBackend ? `${ok} item(s) (records and class sessions) confirmed stored by the backend.` : `${ok} item(s) (records and class sessions) marked Synced by the prototype simulation. Nothing was uploaded to a real server.` });
  }, []);

  // With a real backend configured, sync automatically when the connection returns.
  const syncRef = useRef(syncPending);
  useEffect(() => { syncRef.current = syncPending; }, [syncPending]);
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && hasBackend) void syncRef.current();
    wasOnline.current = online;
  }, [online]);

  const resetDemoData = useCallback(() => {
    saveSettings(seedSettings());
    const s = seedState();
    commit(s.records, s.sessions);
    setSyncNotice(null);
  }, []);

  const value = useMemo<AttendanceCtx>(
    () => ({ records, sessions, counts, storageError, syncing, forceError, setForceError, syncNotice, markAttendance, saveBatch, finalizeSession, cancelSession, syncPending, resetDemoData }),
    [records, sessions, counts, storageError, syncing, forceError, syncNotice, markAttendance, saveBatch, finalizeSession, cancelSession, syncPending, resetDemoData]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAttendance(): AttendanceCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAttendance must be used inside AttendanceProvider");
  return v;
}
