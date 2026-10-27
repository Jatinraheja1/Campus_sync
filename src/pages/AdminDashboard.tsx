import { BarChart3, CheckCircle2, Clock, Database, FileClock, History, RotateCcw, Wifi, WifiOff } from "lucide-react";
import AdminAnalyticsPanel from "../components/AdminAnalyticsPanel";
import AppShell from "../components/AppShell";
import RiskRadar from "../components/RiskRadar";
import StatCard from "../components/StatCard";
import { useAttendance } from "../context/AttendanceContext";
import { useAuth } from "../context/AuthContext";
import { useConnectivity } from "../context/ConnectivityContext";
import FaceEnrollmentPanel from "../components/FaceEnrollmentPanel";
import UserManagement from "../components/UserManagement";
import AuditLogViewer from "../components/AuditLogViewer";
import { hasBackend } from "../lib/api";
import AdminTimetable from "../components/AdminTimetable";
import AIControlCenter from "../components/AIControlCenter";
import AdminAttendanceHistory from "../components/AdminAttendanceHistory";
import { useState } from "react";

export default function AdminDashboard() {
  const { user } = useAuth();
  const { records, counts, resetDemoData } = useAttendance();
  const { online } = useConnectivity();
  const [activePanel, setActivePanel] = useState<"none" | "analytics" | "history" | "audit">("none");
  if (!user) return null;


  return (
    <AppShell>
      <section className="welcome">
        <h1>Welcome, {user.name}</h1>
        <p className="muted">Monitoring view. Administrators can see attendance and sync status for the whole system.</p>
      </section>

      <section className="stats">
        <StatCard tone="blue" icon={<Database size={20} />} label="Attendance records" value={records.length} />
        <StatCard tone="orange" icon={<Clock size={20} />} label="Pending sync" value={counts.pending} />
        <StatCard tone="green" icon={<CheckCircle2 size={20} />} label="Synced" value={counts.synced} note={hasBackend ? "Backend confirmed" : "Simulated"} />
        <StatCard tone={online ? "green" : "orange"} icon={online ? <Wifi size={20} /> : <WifiOff size={20} />} label="System status" value={online ? "Online" : "Offline"} />
      </section>

      <section className="card panel admin-shortcuts">
        <div><p className="eyebrow">QUICK ACCESS</p><h2>Administration tools</h2><p className="hint">Open reports only when you need them; the dashboard stays focused by default.</p></div>
        <div className="admin-shortcut-grid">
          <button type="button" className={`admin-shortcut ${activePanel === "analytics" ? "selected" : ""}`} onClick={() => setActivePanel(activePanel === "analytics" ? "none" : "analytics")}><span><BarChart3 size={21}/></span><strong>Attendance analytics</strong><small>Trends, risk radar and recent updates</small></button>
          <button type="button" className={`admin-shortcut ${activePanel === "history" ? "selected" : ""}`} onClick={() => setActivePanel(activePanel === "history" ? "none" : "history")}><span><History size={21}/></span><strong>Attendance history</strong><small>Browse latest attendance records</small></button>
          <button type="button" className={`admin-shortcut ${activePanel === "audit" ? "selected" : ""}`} onClick={() => setActivePanel(activePanel === "audit" ? "none" : "audit")}><span><FileClock size={21}/></span><strong>Audit log viewer</strong><small>Review administrative activity</small></button>
        </div>
      </section>

      {activePanel === "analytics" && <><div className="notice notice-info">The legacy analytics and risk radar use this browser’s attendance model. For database-backed records, use Attendance history.</div><AdminAnalyticsPanel /><RiskRadar /></>}
      {activePanel === "history" && <><AdminAttendanceHistory localRecords={records}/><section className="card panel"><div className="panel-head"><div><h2><RotateCcw size={18}/> Local demo data controls</h2><p className="hint">This resets only the demo records saved in this browser; it does not delete PostgreSQL records.</p></div><button className="btn btn-ghost" onClick={() => { if (window.confirm("Reset this browser’s attendance to the original sample data?")) resetDemoData(); }}><RotateCcw size={15}/> Reset local demo data</button></div></section></>}
      {activePanel === "audit" && <AuditLogViewer />}

      <AIControlCenter />
      <AdminTimetable />
      <UserManagement />
      <FaceEnrollmentPanel />
    </AppShell>
  );
}
