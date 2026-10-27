import { useMemo, useState } from "react";
import { BarChart3, Settings } from "lucide-react";
import AttendanceAnalytics from "./AttendanceAnalytics";
import NoticeBox from "./NoticeBox";
import { AttendanceBar, AttendanceFilters, PrototypeNote, ThresholdBadge } from "./AnalyticsParts";
import { useAttendance } from "../context/AttendanceContext";
import { useAuth } from "../context/AuthContext";
import { useAnalyticsSettings } from "../hooks/useAnalyticsSettings";
import { NO_FILTER, computeSectionStats, formatPct, pct, thresholdStatus, type AttendanceFilter } from "../lib/analytics";
import { CLASSES, CLASS_GROUP, SECTIONS, STUDENTS } from "../lib/users";
import type { Notice } from "../types";

/** Administrator analytics: settings, section / subject / student summaries, and individual reports. */
export default function AdminAnalyticsPanel() {
  const { user } = useAuth();
  const { sessions, records } = useAttendance();
  const { settings, save } = useAnalyticsSettings();
  const [filter, setFilter] = useState<AttendanceFilter>(NO_FILTER);
  const [studentId, setStudentId] = useState(STUDENTS[0]?.id ?? "");

  const [thr, setThr] = useState(settings.thresholdPct === null ? "" : String(settings.thresholdPct));
  const [semStart, setSemStart] = useState(settings.semesterStart ?? "");
  const [semEnd, setSemEnd] = useState(settings.semesterEnd ?? "");
  const [enr, setEnr] = useState<Record<string, string>>(settings.enrolledOn);
  const [notice, setNotice] = useState<Notice | null>(null);

  const data = useMemo(() => ({ sessions, records, settings }), [sessions, records, settings]);
  const sections = useMemo(() => SECTIONS.map((s) => computeSectionStats(s, STUDENTS, CLASSES, data, filter)), [data, filter]);
  const all = useMemo(() => {
    const attended = sections.reduce((a, s) => a + s.attended, 0);
    const possible = sections.reduce((a, s) => a + s.possible, 0);
    return { sessions: sections.reduce((a, s) => a + s.sessions, 0), attended, possible, percentage: pct(attended, possible) };
  }, [sections]);

  if (!user || user.role !== "admin") return null;

  const saveSettings = () => {
    const t = thr.trim();
    const n = t === "" ? null : Number(t);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) return setNotice({ kind: "error", text: "The minimum attendance must be a number from 0 to 100, or empty for no minimum." });
    if (semStart && semEnd && semStart > semEnd) return setNotice({ kind: "error", text: "The semester start date is after its end date." });
    const enrolledOn: Record<string, string> = {};
    for (const [k, v] of Object.entries(enr)) if (v) enrolledOn[k] = v;
    const err = save({ thresholdPct: n, semesterStart: semStart || null, semesterEnd: semEnd || null, enrolledOn });
    setNotice(err ? { kind: "error", text: err } : { kind: "success", text: "Analytics settings saved. All dashboards now use them." });
  };

  const stat = (p: number | null) => thresholdStatus(p, settings.thresholdPct);

  return (
    <>
      <section className="card panel" aria-labelledby="aa-settings">
        <h2 id="aa-settings"><Settings size={18} /> Attendance analytics settings</h2>
        <div className="selectors">
          <div><label htmlFor="aa-thr">Minimum attendance (%)</label>
            <input id="aa-thr" type="text" inputMode="decimal" placeholder="Not set" value={thr} onChange={(e) => setThr(e.target.value)} /></div>
          <div><label htmlFor="aa-ss">Semester start</label><input id="aa-ss" type="date" value={semStart} onChange={(e) => setSemStart(e.target.value)} /></div>
          <div><label htmlFor="aa-se">Semester end</label><input id="aa-se" type="date" value={semEnd} onChange={(e) => setSemEnd(e.target.value)} /></div>
        </div>
        <details className="about">
          <summary>Student enrollment dates (classes before this date are not counted for that student)</summary>
          <div className="selectors">
            {STUDENTS.map((s) => (
              <div key={s.id}><label htmlFor={`aa-en-${s.id}`}>{s.name} ({s.id})</label>
                <input id={`aa-en-${s.id}`} type="date" value={enr[s.id] ?? ""} onChange={(e) => setEnr((p) => ({ ...p, [s.id]: e.target.value }))} /></div>
            ))}
          </div>
        </details>
        <div className="row-actions"><button type="button" className="btn btn-primary" onClick={saveSettings}>Save settings</button></div>
        <p className="hint">No minimum is assumed. Leave it empty to show no warnings. Enrollment dates are empty by default (counted from the first class).</p>
        <NoticeBox notice={notice} />
      </section>

      <section className="card panel" aria-labelledby="aa-title">
        <h2 id="aa-title"><BarChart3 size={18} /> Attendance analytics: {CLASS_GROUP}</h2>
        <PrototypeNote />
        <AttendanceFilters value={filter} onChange={setFilter} subjects={CLASSES} settings={settings} idPrefix="aa" />

        <h3>Overall attendance by section</h3>
        <div className="table-wrap">
          <table className="stack">
            <thead><tr><th>Section</th><th>Students</th><th>Classes conducted</th><th>Attended / possible</th><th>Attendance</th><th>Status</th></tr></thead>
            <tbody>
              {sections.map((s) => (
                <tr key={s.section}>
                  <td data-label="Section"><strong>Section {s.section}</strong></td>
                  <td data-label="Students">{s.students.length}</td>
                  <td data-label="Classes conducted">{s.sessions}</td>
                  <td data-label="Attended / possible">{s.attended} / {s.possible}</td>
                  <td data-label="Attendance"><AttendanceBar value={s.percentage} status={stat(s.percentage)} threshold={settings.thresholdPct} label={`Section ${s.section} attendance`} /></td>
                  <td data-label="Status"><ThresholdBadge status={stat(s.percentage)} threshold={settings.thresholdPct} /></td>
                </tr>
              ))}
              <tr>
                <td data-label="Section"><strong>All sections</strong></td>
                <td data-label="Students">{STUDENTS.length}</td>
                <td data-label="Classes conducted">{all.sessions}</td>
                <td data-label="Attended / possible">{all.attended} / {all.possible}</td>
                <td data-label="Attendance"><AttendanceBar value={all.percentage} status={stat(all.percentage)} threshold={settings.thresholdPct} label="All sections attendance" /></td>
                <td data-label="Status"><ThresholdBadge status={stat(all.percentage)} threshold={settings.thresholdPct} /></td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Subject-wise summary and classes conducted</h3>
        <div className="table-wrap">
          <table className="stack">
            <thead><tr><th>Subject</th><th>Section</th><th>Classes conducted</th><th>Attended / possible</th><th>Attendance</th><th>Status</th></tr></thead>
            <tbody>
              {sections.flatMap((s) => s.bySubject.map((b) => (
                <tr key={`${s.section}-${b.subjectId}`}>
                  <td data-label="Subject"><strong>{b.subjectName}</strong> <span className="muted small">{b.subjectId}</span></td>
                  <td data-label="Section">{s.section}</td>
                  <td data-label="Classes conducted">{b.sessions}</td>
                  <td data-label="Attended / possible">{b.attended} / {b.possible}</td>
                  <td data-label="Attendance"><AttendanceBar value={b.percentage} status={stat(b.percentage)} threshold={settings.thresholdPct} label={`${b.subjectName} Section ${s.section}`} /></td>
                  <td data-label="Status"><ThresholdBadge status={stat(b.percentage)} threshold={settings.thresholdPct} /></td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>

        <h3>Attendance percentages across students</h3>
        <div className="table-wrap">
          <table className="stack">
            <thead><tr><th>Student</th><th>Section</th><th>Attended</th><th>Conducted</th><th>Missed</th><th>Attendance</th><th>Status</th><th>Report</th></tr></thead>
            <tbody>
              {sections.flatMap((s) => s.students.map(({ student, stats }) => (
                <tr key={student.id}>
                  <td data-label="Student"><strong>{student.name}</strong> <span className="muted small">{student.id}</span></td>
                  <td data-label="Section">{student.section}</td>
                  <td data-label="Attended">{stats.overall.attended}</td>
                  <td data-label="Conducted">{stats.overall.conducted}</td>
                  <td data-label="Missed">{stats.overall.missed}</td>
                  <td data-label="Attendance"><AttendanceBar value={stats.overall.percentage} status={stat(stats.overall.percentage)} threshold={settings.thresholdPct} label={`${student.name} attendance`} /></td>
                  <td data-label="Status"><ThresholdBadge status={stat(stats.overall.percentage)} threshold={settings.thresholdPct} /></td>
                  <td data-label="Report"><button type="button" className="btn btn-outline" onClick={() => setStudentId(student.id)}>View report</button></td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
        <p className="hint">Section totals add up attended and conducted classes across students (weighted); percentages are never averaged. Overall: {formatPct(all.percentage)}.</p>
      </section>

      <section className="card panel" aria-labelledby="aa-ind">
        <h2 id="aa-ind">Individual student report</h2>
        <label htmlFor="aa-stu">Student</label>
        <select id="aa-stu" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          {STUDENTS.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id}, Section {s.section})</option>)}
        </select>
      </section>
      <AttendanceAnalytics key={studentId} studentId={studentId} viewer={user} />
    </>
  );
}
