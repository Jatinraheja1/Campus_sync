import { AlertTriangle, Ban, CheckCircle2, Clock, HelpCircle, Info, UserCheck, UserX } from "lucide-react";
import { formatPct, type AttendanceFilter, type HistoryState, type SubjectRef, type ThresholdStatus } from "../lib/analytics";
import { hasBackend } from "../lib/api";
import type { AnalyticsSettings } from "../types";

/** Progress bar. The number is always printed next to it, and the status is a text label, so colour is never the only signal. */
export function AttendanceBar({ value, status, threshold, label }: { value: number | null; status: ThresholdStatus; threshold: number | null; label: string }) {
  if (value === null) return <span className="muted small">No classes yet</span>;
  return (
    <div className="abar-wrap">
      <div className="abar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100) / 100} aria-valuetext={`${value.toFixed(2)} percent`}>
        <div className={`abar-fill abar-${status}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        {threshold !== null && <span className="abar-mark" style={{ left: `${threshold}%` }} title={`Minimum ${threshold}%`} />}
      </div>
      <span className="abar-num">{formatPct(value)}</span>
    </div>
  );
}

export function ThresholdBadge({ status, threshold }: { status: ThresholdStatus; threshold: number | null }) {
  if (status === "below") return <span className="badge badge-red"><AlertTriangle size={14} /> Below {threshold}% minimum</span>;
  if (status === "meets") return <span className="badge badge-green"><CheckCircle2 size={14} /> Meets {threshold}% minimum</span>;
  if (status === "no-threshold") return <span className="badge badge-grey"><HelpCircle size={14} /> No minimum set</span>;
  return <span className="badge badge-grey">No classes yet</span>;
}

const HISTORY_LABEL: Record<HistoryState, string> = {
  present: "Present (confirmed)", absent: "Absent (confirmed)", pending: "Pending. Not counted", unrecorded: "Not recorded", cancelled: "Cancelled. Not counted",
};
export function HistoryBadge({ state }: { state: HistoryState }) {
  const Icon = state === "present" ? UserCheck : state === "absent" ? UserX : state === "pending" ? Clock : state === "cancelled" ? Ban : HelpCircle;
  const cls = state === "present" ? "badge-blue" : state === "absent" ? "badge-red" : state === "pending" ? "badge-orange" : "badge-grey";
  return <span className={`badge ${cls}`}><Icon size={14} /> {HISTORY_LABEL[state]}</span>;
}

export function PrototypeNote() {
  return (
    <div className="notice notice-info" role="note">
      <Info size={18} />
      <span>
        Analytics are calculated from attendance saved in <strong>this browser</strong> (prototype data) and are not shared across devices
        {hasBackend ? "; the backend currently only receives uploads, nothing is downloaded from it" : ""}. Only records confirmed as synced are counted. Pending ones are listed but never counted.
      </span>
    </div>
  );
}

export function ThresholdNote({ settings }: { settings: AnalyticsSettings }) {
  if (settings.thresholdPct !== null) return <p className="hint">Minimum attendance set by the administrator: <strong>{settings.thresholdPct}%</strong>.</p>;
  return <p className="hint">No minimum attendance has been configured by the administrator, so no warnings are shown.</p>;
}

export function AttendanceFilters({ value, onChange, subjects, settings, idPrefix }: {
  value: AttendanceFilter; onChange: (f: AttendanceFilter) => void; subjects: SubjectRef[]; settings: AnalyticsSettings; idPrefix: string;
}) {
  const hasSemester = !!(settings.semesterStart || settings.semesterEnd);
  const bad = !!(value.from && value.to && value.from > value.to);
  const active = value.subjectId || value.from || value.to || value.semester;
  return (
    <div className="filters" role="group" aria-label="Attendance filters">
      <div><label htmlFor={`${idPrefix}-sub`}>Subject</label>
        <select id={`${idPrefix}-sub`} value={value.subjectId ?? ""} onChange={(e) => onChange({ ...value, subjectId: e.target.value || null })}>
          <option value="">All subjects</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
        </select></div>
      <div><label htmlFor={`${idPrefix}-from`}>From</label>
        <input id={`${idPrefix}-from`} type="date" value={value.from ?? ""} aria-invalid={bad} onChange={(e) => onChange({ ...value, from: e.target.value || null })} /></div>
      <div><label htmlFor={`${idPrefix}-to`}>To</label>
        <input id={`${idPrefix}-to`} type="date" value={value.to ?? ""} aria-invalid={bad} onChange={(e) => onChange({ ...value, to: e.target.value || null })} /></div>
      <div className="filter-actions">
        {hasSemester && (
          <label className="check" htmlFor={`${idPrefix}-sem`}>
            <input id={`${idPrefix}-sem`} type="checkbox" checked={value.semester} onChange={(e) => onChange({ ...value, semester: e.target.checked })} />
            Current semester{settings.semesterStart || settings.semesterEnd ? ` (${settings.semesterStart ?? "…"} to ${settings.semesterEnd ?? "…"})` : ""}
          </label>
        )}
        {active && <button type="button" className="btn btn-outline" onClick={() => onChange({ subjectId: null, from: null, to: null, semester: false })}>Clear filters</button>}
      </div>
      {bad && <p className="field-error" role="alert">The start date is after the end date, so no classes match.</p>}
    </div>
  );
}
