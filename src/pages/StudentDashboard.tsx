import { useMemo } from "react";
import { CalendarCheck, Clock, Database, Wifi, WifiOff } from "lucide-react";
import AppShell from "../components/AppShell";
import AttendanceAnalytics from "../components/AttendanceAnalytics";
import RecordsTable from "../components/RecordsTable";
import StatCard from "../components/StatCard";
import StatusBadge, { AttendanceBadge } from "../components/StatusBadge";
import { useAttendance } from "../context/AttendanceContext";
import { useAuth } from "../context/AuthContext";
import { useConnectivity } from "../context/ConnectivityContext";
import { todayLocal } from "../lib/utils";

export default function StudentDashboard() {
  const { user } = useAuth();
  const { records } = useAttendance();
  const { online } = useConnectivity();

  // Students only ever see their own records (this filter is a frontend demo protection; enforce on the backend too).
  const mine = useMemo(() => records.filter((r) => r.studentId === user?.id), [records, user]);
  if (!user) return null;

  const today = mine.filter((r) => r.date === todayLocal());
  const presentToday = today.some((r) => r.attendance === "Present");
  const absentToday = !presentToday && today.some((r) => r.attendance === "Absent");
  const pending = mine.filter((r) => r.status !== "Synced").length;
  const presentCount = mine.filter((r) => r.attendance === "Present").length;
  const absentCount = mine.filter((r) => r.attendance === "Absent").length;

  return (
    <AppShell>
      <section className="welcome">
        <h1>Welcome, {user.name}</h1>
        <p className="muted">Student ID: {user.id}. This view is read-only; attendance is confirmed by your teacher.</p>
      </section>

      <AttendanceAnalytics studentId={user.id} viewer={user} />

      <section className="stats">
        <StatCard tone={online ? "green" : "orange"} icon={online ? <Wifi size={20} /> : <WifiOff size={20} />} label="Connection" value={online ? "Online" : "Offline"} />
        <StatCard tone={presentToday ? "green" : "orange"} icon={<CalendarCheck size={20} />} label="Today" value={presentToday ? "Present" : absentToday ? "Absent" : "Not marked"} note={today.length ? `${today.length} record(s)` : "No record yet"} />
        <StatCard tone="blue" icon={<Database size={20} />} label="Total records" value={mine.length} note={`${presentCount} present, ${absentCount} absent`} />
        <StatCard tone="orange" icon={<Clock size={20} />} label="Pending sync" value={pending} note="Your records only" />
      </section>

      {pending > 0 && (
        <div className="notice notice-info" role="status">
          <Clock size={18} />
          <span>{pending} of your record(s) are saved on the device and waiting for synchronization.{!online && " They will sync after the connection returns."}</span>
        </div>
      )}

      <section className="card panel">
        <h2>Today's attendance</h2>
        {today.length === 0 ? (
          <p className="muted">Nothing has been confirmed for you today. Your teacher confirms attendance during class.</p>
        ) : (
          <ul className="today-list">
            {today.map((r) => (
              <li key={r.id}>
                <span><strong>{r.className}</strong> <span className="muted">({r.classId}, Sec {r.section})</span></span>
                <span className="row-actions"><AttendanceBadge value={r.attendance} /><StatusBadge status={r.status} /></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card panel">
        <h2>My attendance records (sync details)</h2>
        <RecordsTable records={mine.slice(0, 30)} showStudent={false} showMarkedBy emptyTitle="No attendance recorded for you yet" emptyText="Once a teacher confirms your attendance, the record appears here." />
      </section>
    </AppShell>
  );
}
