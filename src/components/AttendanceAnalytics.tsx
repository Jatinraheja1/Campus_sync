import { useMemo, useState } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, Clock, Library, Percent, XCircle } from "lucide-react";
import StatCard from "./StatCard";
import { AttendanceBar, AttendanceFilters, HistoryBadge, PrototypeNote, ThresholdBadge, ThresholdNote } from "./AnalyticsParts";
import { useAttendance } from "../context/AttendanceContext";
import { useAnalyticsSettings } from "../hooks/useAnalyticsSettings";
import { NO_FILTER, buildHistory, computeStudentStats, formatPct, thresholdStatus, type AttendanceFilter } from "../lib/analytics";
import { CLASSES, STUDENTS } from "../lib/users";
import type { Account } from "../types";

const HISTORY_LIMIT = 50;

/**
 * Attendance Overview + Subject-Wise Attendance + History for ONE student.
 * A student account can only ever see its own data; administrators may open any student's report.
 */
export default function AttendanceAnalytics({ studentId, viewer }: { studentId: string; viewer: Account }) {
  const { sessions, records } = useAttendance();
  const { settings } = useAnalyticsSettings();
  const [filter, setFilter] = useState<AttendanceFilter>(NO_FILTER);
  const [showAll, setShowAll] = useState(false);

  const student = STUDENTS.find((s) => s.id === studentId);
  const data = useMemo(() => ({ sessions, records, settings }), [sessions, records, settings]);
  const stats = useMemo(() => (student ? computeStudentStats(student, CLASSES, data, filter) : null), [student, data, filter]);
  const history = useMemo(() => (student ? buildHistory(student, CLASSES, data, filter) : []), [student, data, filter]);

  if (!student || !stats) return null;
  if (viewer.role === "student" && viewer.id !== studentId) return null;

  const { overall } = stats;
  const status = thresholdStatus(overall.percentage, settings.thresholdPct);
  const pendingCount = history.filter((h) => h.state === "pending").length;
  const filtered = !!(filter.subjectId || filter.from || filter.to || filter.semester);
  const shown = showAll ? history : history.slice(0, HISTORY_LIMIT);
  const below = stats.bySubject.filter((s) => thresholdStatus(s.percentage, settings.thresholdPct) === "below");

  return (
    <>
      <section className="card panel" aria-labelledby={`ov-${studentId}`}>
        <h2 id={`ov-${studentId}`}><Percent size={18} /> Attendance Overview{viewer.role !== "student" ? `: ${student.name}` : ""}</h2>
        <PrototypeNote />
        <AttendanceFilters value={filter} onChange={setFilter} subjects={CLASSES} settings={settings} idPrefix={`f-${studentId}`} />
        {filtered && <p className="hint">Filters are on: every number and percentage below only covers the selected subject and dates.</p>}

        {overall.conducted === 0 ? (
          <div className="empty" role="status">
            <BookOpen size={34} />
            <p><strong>No attendance data available</strong></p>
            <p>{filtered ? "No confirmed classes match these filters." : "No classes have been confirmed for you yet. Your attendance appears here after a teacher finalizes a class and it is synchronized."}</p>
          </div>
        ) : (
          <>
            <section className="stats stats-5">
              <StatCard tone={status === "below" ? "orange" : "blue"} icon={<Percent size={20} />} label="Overall attendance" value={formatPct(overall.percentage)} note={status === "below" ? `Below ${settings.thresholdPct}% minimum` : status === "meets" ? `Meets ${settings.thresholdPct}% minimum` : undefined} />
              <StatCard tone="blue" icon={<BookOpen size={20} />} label="Classes conducted" value={overall.conducted} />
              <StatCard tone="green" icon={<CheckCircle2 size={20} />} label="Classes attended" value={overall.attended} />
              <StatCard tone="orange" icon={<XCircle size={20} />} label="Classes missed" value={overall.missed} note={overall.unrecorded ? `+${overall.unrecorded} not recorded` : undefined} />
              <StatCard tone="blue" icon={<Library size={20} />} label="Subjects" value={overall.subjects} />
            </section>
            <AttendanceBar value={overall.percentage} status={status} threshold={settings.thresholdPct} label="Overall attendance" />
            <p className="hint">Overall = total attended ÷ total conducted across subjects × 100 ({overall.attended} ÷ {overall.conducted}). It is not the average of subject percentages.</p>
          </>
        )}

        {status === "below" && (
          <div className="notice notice-error" role="alert">
            <AlertTriangle size={18} />
            <span><strong>Warning:</strong> overall attendance is {formatPct(overall.percentage)}, below the {settings.thresholdPct}% minimum set by the administrator.</span>
          </div>
        )}
        {below.length > 0 && status !== "below" && (
          <div className="notice notice-error" role="alert">
            <AlertTriangle size={18} />
            <span><strong>Warning:</strong> below the {settings.thresholdPct}% minimum in {below.map((b) => b.subjectName).join(", ")}.</span>
          </div>
        )}
        {pendingCount > 0 && (
          <div className="notice notice-info" role="status">
            <Clock size={18} />
            <span>{pendingCount} class(es) are waiting for synchronization or finalization. They are shown in the history below but are <strong>not counted</strong> yet.</span>
          </div>
        )}
        <ThresholdNote settings={settings} />
      </section>

      <section className="card panel" aria-labelledby={`sw-${studentId}`}>
        <h2 id={`sw-${studentId}`}><Library size={18} /> Subject-Wise Attendance</h2>
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr><th>Subject</th><th>Code</th><th>Total classes</th><th>Attended</th><th>Missed</th><th>Attendance</th><th>Progress</th><th>Status</th></tr>
            </thead>
            <tbody>
              {stats.bySubject.map((s) => {
                const st = thresholdStatus(s.percentage, settings.thresholdPct);
                return (
                  <tr key={s.subjectId}>
                    <td data-label="Subject"><strong>{s.subjectName}</strong></td>
                    <td data-label="Code" className="mono">{s.subjectId}</td>
                    <td data-label="Total classes">{s.conducted}</td>
                    <td data-label="Attended">{s.attended}</td>
                    <td data-label="Missed">{s.missed}{s.unrecorded > 0 && <span className="muted small"> (+{s.unrecorded} not recorded)</span>}</td>
                    <td data-label="Attendance"><strong>{s.percentage === null ? "No classes yet" : formatPct(s.percentage)}</strong></td>
                    <td data-label="Progress"><AttendanceBar value={s.percentage} status={st} threshold={settings.thresholdPct} label={`${s.subjectName} attendance`} /></td>
                    <td data-label="Status"><ThresholdBadge status={st} threshold={settings.thresholdPct} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {student && settings.enrolledOn[student.id] && <p className="hint">Enrolled on {settings.enrolledOn[student.id]}: only classes from that date are counted.</p>}
      </section>

      <section className="card panel" aria-labelledby={`hi-${studentId}`}>
        <h2 id={`hi-${studentId}`}><Clock size={18} /> Attendance History</h2>
        {history.length === 0 ? (
          <div className="empty"><p><strong>No classes to show</strong></p><p>{filtered ? "Nothing matches these filters." : "Class history appears here once classes have been recorded."}</p></div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="stack">
                <thead><tr><th>Date</th><th>Subject</th><th>Status</th><th>Note</th></tr></thead>
                <tbody>
                  {shown.map((h) => (
                    <tr key={h.sessionId}>
                      <td data-label="Date">{h.date}</td>
                      <td data-label="Subject">{h.subjectName} <span className="muted small">({h.subjectId})</span></td>
                      <td data-label="Status"><HistoryBadge state={h.state} /></td>
                      <td data-label="Note" className="muted small">{h.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {history.length > HISTORY_LIMIT && (
              <button type="button" className="btn btn-outline" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${history.length} classes`}
              </button>
            )}
          </>
        )}
      </section>
    </>
  );
}
