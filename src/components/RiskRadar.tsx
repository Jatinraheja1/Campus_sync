import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { BACKEND_URL, hasBackend } from "../lib/api";
import { TOKEN_KEY } from "../lib/authToken";

type RiskStudent = { studentId: string; studentName: string; section: string; subjectId: string; total: number; present: number; attendancePercent: number };

export default function RiskRadar() {
  const [students, setStudents] = useState<RiskStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const load = useCallback(async () => {
    if (!BACKEND_URL) return;
    setLoading(true); setError("");
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${BACKEND_URL}/reports/risk-radar`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      setStudents(Array.isArray(data.studentsAtRisk) ? data.studentsAtRisk : []);
      setUpdatedAt(data.generatedAt || new Date().toISOString());
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load risk report"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!hasBackend) return <section className="card panel"><h2><AlertTriangle size={18} /> Smart Risk Radar</h2><p className="muted">Connect the PostgreSQL backend to calculate real attendance-risk alerts. Demo mode does not invent risk scores.</p></section>;
  return <section className="card panel" aria-live="polite">
    <div className="panel-head"><div><h2><AlertTriangle size={18} /> Smart Risk Radar</h2><p className="muted">Flags students whose recorded attendance is below 75%.</p></div><button className="btn btn-ghost" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
    {loading && <p className="muted">Calculating from PostgreSQL attendance records…</p>}
    {error && <div className="notice notice-error">{error}</div>}
    {!loading && !error && students.length === 0 && <div className="notice"><ShieldCheck size={17} /> No students are currently below the 75% threshold in the available records.</div>}
    {students.length > 0 && <div className="table-wrap"><table><thead><tr><th>Student</th><th>Subject</th><th>Section</th><th>Attendance</th><th>Risk</th></tr></thead><tbody>{students.map((s) => <tr key={`${s.studentId}-${s.subjectId}`}><td><strong>{s.studentName}</strong><div className="muted mono">{s.studentId}</div></td><td>{s.subjectId}</td><td>{s.section}</td><td>{s.attendancePercent}% ({s.present}/{s.total})</td><td><span className="badge badge-orange">{s.attendancePercent < 50 ? "High" : "Needs attention"}</span></td></tr>)}</tbody></table></div>}
    {updatedAt && <p className="hint">Calculated from saved attendance records · Updated {new Date(updatedAt).toLocaleString()}</p>}
  </section>;
}
