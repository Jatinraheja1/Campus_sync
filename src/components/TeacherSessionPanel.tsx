import { useMemo, useState } from "react";
import { Ban, CalendarCheck, Lock } from "lucide-react";
import NoticeBox from "./NoticeBox";
import StatusBadge, { AttendanceBadge } from "./StatusBadge";
import { AttendanceBar, PrototypeNote, ThresholdBadge } from "./AnalyticsParts";
import { useAttendance } from "../context/AttendanceContext";
import { useAnalyticsSettings } from "../hooks/useAnalyticsSettings";
import { NO_FILTER, computeStudentStats, finalizeCheck, formatPct, makeSessionId, rosterFor, sessionCounts, thresholdStatus } from "../lib/analytics";
import { CLASSES, CLASS_GROUP, SECTIONS, STUDENTS } from "../lib/users";
import { todayLocal } from "../lib/utils";
import type { Notice, Teacher } from "../types";

/** Teacher view: pick class / section / subject / date, see the session, finalize or cancel it, and see per-student counts. */
export default function TeacherSessionPanel({ teacher }: { teacher: Teacher }) {
  const { sessions, records, finalizeSession, cancelSession } = useAttendance();
  const { settings } = useAnalyticsSettings();
  const subjects = useMemo(() => CLASSES.filter((c) => teacher.classIds.includes(c.id)), [teacher]);
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [section, setSection] = useState(SECTIONS[0]);
  const [date, setDate] = useState(todayLocal());
  const [notice, setNotice] = useState<Notice | null>(null);

  const data = useMemo(() => ({ sessions, records, settings }), [sessions, records, settings]);
  const sid = makeSessionId(section, subjectId, date);
  const session = sessions.find((s) => s.id === sid);
  const sessionRecords = useMemo(() => new Map(records.filter((r) => r.sessionId === sid).map((r) => [r.studentId, r])), [records, sid]);
  const roster = useMemo(() => rosterFor(STUDENTS, section, date, settings), [section, date, settings]);
  const check = finalizeCheck(session, records.filter((r) => r.sessionId === sid), roster);
  const counts = useMemo(() => sessionCounts(section, subjectId, data), [section, subjectId, data]);
  const subject = subjects.find((s) => s.id === subjectId);
  const rows = useMemo(
    () => (subject ? roster.map((student) => ({ student, stat: computeStudentStats(student, [subject], data, NO_FILTER).bySubject[0] })) : []),
    [roster, subject, data]
  );

  if (!subject) return <div className="notice notice-error">No subjects are assigned to this teacher.</div>;
  const ref = { section, subjectId, date, teacher };
  const status = session?.status ?? "none";

  return (
    <section className="card panel" aria-labelledby="sess-title">
      <h2 id="sess-title"><CalendarCheck size={18} /> Class sessions and counts</h2>
      <PrototypeNote />
      <div className="selectors">
        <div><label htmlFor="ts-cg">Class</label><select id="ts-cg" value={CLASS_GROUP} disabled><option>{CLASS_GROUP}</option></select></div>
        <div><label htmlFor="ts-sec">Section</label>
          <select id="ts-sec" value={section} onChange={(e) => { setSection(e.target.value); setNotice(null); }}>{SECTIONS.map((s) => <option key={s} value={s}>Section {s}</option>)}</select></div>
        <div><label htmlFor="ts-sub">Subject</label>
          <select id="ts-sub" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setNotice(null); }}>{subjects.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}</select></div>
        <div><label htmlFor="ts-dt">Date</label>
          <input id="ts-dt" type="date" value={date} max={todayLocal()} onChange={(e) => { setDate(e.target.value || todayLocal()); setNotice(null); }} /></div>
      </div>

      <div className="summary">
        <strong>Classes conducted ({subject.name}, Section {section}): {counts.conducted}</strong>
        <span className="muted small"> confirmed and synced. Also: {counts.pendingSync} finalized awaiting sync, {counts.drafts} not finalized, {counts.cancelled} cancelled (none of these are counted).</span>
      </div>

      <div className="summary">
        <span>Session for {date}: </span>
        {status === "none" && <span className="badge badge-grey">No attendance recorded yet</span>}
        {status === "scheduled" && <span className="badge badge-orange">Draft. Not finalized</span>}
        {status === "finalized" && <span className="badge badge-blue"><Lock size={14} /> Finalized</span>}
        {status === "cancelled" && <span className="badge badge-grey"><Ban size={14} /> Cancelled</span>}
        {session && status !== "scheduled" && <> <StatusBadge status={session.syncStatus} /></>}
      </div>

      <div className="row-actions">
        <button type="button" className="btn btn-primary" disabled={!check.ok} onClick={() => setNotice(finalizeSession(ref))}>Finalize class session</button>
        <button type="button" className="btn btn-outline" disabled={status === "finalized" || status === "cancelled"}
          onClick={() => { if (window.confirm(`Cancel the ${subject.name} class for Section ${section} on ${date}? Cancelled classes never count.`)) setNotice(cancelSession(ref)); }}>
          <Ban size={15} /> Cancel class
        </button>
      </div>
      {!check.ok && status !== "finalized" && status !== "cancelled" && check.reason && <p className="hint">{check.reason}</p>}
      <p className="hint">A class is counted once, when it is finalized. Editing attendance or retrying synchronization never adds another class. Finalized classes are locked.</p>
      <NoticeBox notice={notice} />

      <h3>Attendance count for each student ({subject.name})</h3>
      {rows.length === 0 ? (
        <p className="muted">No students are enrolled in Section {section} on {date}.</p>
      ) : (
        <div className="table-wrap">
          <table className="stack">
            <thead><tr><th>Student</th><th>This class ({date})</th><th>Attended</th><th>Conducted</th><th>Missed</th><th>Attendance</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map(({ student, stat }) => {
                const rec = sessionRecords.get(student.id);
                const st = thresholdStatus(stat.percentage, settings.thresholdPct);
                return (
                  <tr key={student.id}>
                    <td data-label="Student"><strong>{student.name}</strong> <span className="muted small">{student.id}</span></td>
                    <td data-label={`This class (${date})`}>{rec ? <span className="row-actions"><AttendanceBadge value={rec.attendance} /><StatusBadge status={rec.status} /></span> : <span className="badge badge-grey">Not marked</span>}</td>
                    <td data-label="Attended">{stat.attended}</td>
                    <td data-label="Conducted">{stat.conducted}</td>
                    <td data-label="Missed">{stat.missed}</td>
                    <td data-label="Attendance"><AttendanceBar value={stat.percentage} status={st} threshold={settings.thresholdPct} label={`${student.name} attendance`} /><span className="sr-only">{formatPct(stat.percentage)}</span></td>
                    <td data-label="Status"><ThresholdBadge status={st} threshold={settings.thresholdPct} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
