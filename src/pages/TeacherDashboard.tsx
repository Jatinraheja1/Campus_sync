import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CalendarDays, CheckCircle2, Clock, RefreshCw, ScanFace, Search, UserCheck, UserX, Users, Wifi, WifiOff } from "lucide-react";
import AppShell from "../components/AppShell";
import RiskRadar from "../components/RiskRadar";
import ClassCapturePanel from "../components/ClassCapturePanel";
import BackendTeacherCameraPanel from "../components/BackendTeacherCameraPanel";
import NoticeBox from "../components/NoticeBox";
import RecordsTable from "../components/RecordsTable";
import StatCard from "../components/StatCard";
import StatusBadge, { AttendanceBadge } from "../components/StatusBadge";
import SyncPanel from "../components/SyncPanel";
import TeacherSessionPanel from "../components/TeacherSessionPanel";
import Workflow from "../components/Workflow";
import { useAttendance } from "../context/AttendanceContext";
import { useAuth } from "../context/AuthContext";
import { useConnectivity } from "../context/ConnectivityContext";
import { BACKEND_URL, hasBackend } from "../lib/api";
import { TOKEN_KEY } from "../lib/authToken";
import { CLASSES, STUDENTS, TEACHERS } from "../lib/users";
import { todayLocal } from "../lib/utils";
import type { ClassInfo, Notice, Student, Teacher } from "../types";

function DemoTeacherDashboard() {
  const { user } = useAuth();
  const { records, counts, markAttendance } = useAttendance();
  const { online } = useConnectivity();
  const teacher = TEACHERS.find((t) => t.id === user?.id);
  const classes = useMemo(() => CLASSES.filter((c) => teacher?.classIds.includes(c.id)), [teacher]);
  const [mode, setMode] = useState<"capture" | "manual" | "sessions">("capture");
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const cls = classes.find((c) => c.id === classId);
  const classRecords = useMemo(() => records.filter((r) => r.classId === classId), [records, classId]);
  const todayMap = useMemo(() => {
    const m = new Map<string, (typeof records)[number]>();
    classRecords.filter((r) => r.date === todayLocal()).forEach((r) => m.set(r.studentId, r));
    return m;
  }, [classRecords]);

  if (!user || !teacher || !cls) return <AppShell><div className="notice notice-error">No classes are assigned to this teacher.</div></AppShell>;

  const q = query.trim().toLowerCase();
  const roster = STUDENTS.filter((s) => !q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
  const presentToday = [...todayMap.values()].filter((r) => r.attendance === "Present").length;

  return (
    <AppShell>
      <section className="welcome">
        <h1>Welcome, {teacher.name}</h1>
        <p className="muted">Teacher ID: {teacher.id}. Mark attendance for your classes. It works offline.</p>
      </section>

      <section className="stats">
        <StatCard tone={online ? "green" : "orange"} icon={online ? <Wifi size={20} /> : <WifiOff size={20} />} label="Connection" value={online ? "Online" : "Offline"} />
        <StatCard tone="blue" icon={<Users size={20} />} label={`Present today (${cls.id})`} value={`${presentToday} / ${STUDENTS.length}`} note={cls.name} />
        <StatCard tone="orange" icon={<Clock size={20} />} label="Pending sync" value={counts.pending} note="All classes" />
        <StatCard tone="green" icon={<CheckCircle2 size={20} />} label="Synced" value={counts.synced} note={hasBackend ? "Backend confirmed" : "Simulated"} />
      </section>

      <Workflow active={!online ? 1 : counts.pending > 0 ? 3 : 0} />
      <RiskRadar />

      <div className="mode-tabs" role="tablist" aria-label="Attendance method">
        <button role="tab" aria-selected={mode === "capture"} className={`tab ${mode === "capture" ? "active" : ""}`} onClick={() => setMode("capture")}><ScanFace size={16} /> Capture whole class</button>
        <button role="tab" aria-selected={mode === "manual"} className={`tab ${mode === "manual" ? "active" : ""}`} onClick={() => setMode("manual")}><UserCheck size={16} /> Mark manually</button>
        <button role="tab" aria-selected={mode === "sessions"} className={`tab ${mode === "sessions" ? "active" : ""}`} onClick={() => setMode("sessions")}><CalendarCheck size={16} /> Class sessions</button>
      </div>

      <div className="two-col wide-left">
        {mode === "capture" ? (
          <ClassCapturePanel teacher={teacher} />
        ) : mode === "sessions" ? (
          <TeacherSessionPanel teacher={teacher} />
        ) : (
          <section className="card panel" aria-labelledby="roster-title">
            <h2 id="roster-title"><UserCheck size={18} /> Mark attendance manually</h2>

            <label htmlFor="class">Subject</label>
            <select id="class" value={classId} onChange={(e) => { setClassId(e.target.value); setNotice(null); }}>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
            </select>

            <label htmlFor="search">Find a student</label>
            <div className="search">
              <Search size={16} />
              <input id="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or ID" />
            </div>

            <NoticeBox notice={notice} />

            <ul className="roster">
              {roster.length === 0 && <li className="muted">No student matches “{query}”.</li>}
              {roster.map((s) => {
                const rec = todayMap.get(s.id);
                return (
                  <li key={s.id}>
                    <span><strong>{s.name}</strong> <span className="muted">{s.id}, Sec {s.section}</span></span>
                    {rec ? (
                      <span className="row-actions"><AttendanceBadge value={rec.attendance} /><StatusBadge status={rec.status} /></span>
                    ) : (
                      <span className="row-actions">
                        <button className="btn btn-primary" onClick={() => setNotice(markAttendance(s, cls, teacher))}>Mark present</button>
                        <button className="btn btn-outline" onClick={() => setNotice(markAttendance(s, cls, teacher, "Absent"))}><UserX size={15} /> Mark absent</button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="hint">Records are saved on this device as Pending Sync until they are synchronized.</p>
          </section>
        )}

        <SyncPanel />
      </div>

      <section className="card panel">
        <div className="panel-head">
          <h2>Attendance history</h2>
          <select aria-label="Subject for history" value={classId} onChange={(e) => setClassId(e.target.value)} className="inline-select">
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <RecordsTable records={classRecords.slice(0, 20)} emptyTitle="No records for this subject" emptyText="Confirm attendance to create the first record." />
      </section>
    </AppShell>
  );
}


type ApiTimetableSlot = { id: string; classGroup: string; section: string; subjectId: string; subjectName: string; teacherId: string; teacherName: string; weekday: number; startsAt: string; endsAt: string; room: string };
type ApiStudent = { id: string; name: string; email: string; section: string; classGroup?: string };
async function teacherApi(path: string) {
  if (!BACKEND_URL) throw new Error("Backend is not enabled. Set VITE_API_URL and restart Vite.");
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${BACKEND_URL}${path}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function BackendTeacherDashboard() {
  const { user } = useAuth();
  const { records, counts, markAttendance } = useAttendance();
  const { online } = useConnectivity();
  const [schedule, setSchedule] = useState<ApiTimetableSlot[]>([]);
  const [students, setStudents] = useState<ApiStudent[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [attendanceMode, setAttendanceMode] = useState<"manual" | "camera">("manual");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true); setError("");
    try {
      const [t, firstStudents] = await Promise.all([teacherApi("/timetable"), teacherApi("/students?limit=100&offset=0")]);
      const nextSchedule: ApiTimetableSlot[] = Array.isArray(t.timetable) ? t.timetable : [];
      const roster: ApiStudent[] = Array.isArray(firstStudents.students) ? [...firstStudents.students] : [];
      let offset = 100;
      while (roster.length >= offset && offset < 2000) {
        const next = await teacherApi(`/students?limit=100&offset=${offset}`);
        const batch: ApiStudent[] = Array.isArray(next.students) ? next.students : [];
        roster.push(...batch);
        if (batch.length < 100) break;
        offset += 100;
      }
      setSchedule(nextSchedule); setStudents(roster);
      setSelectedSlotId(current => current && nextSchedule.some(slot => slot.id === current) ? current : nextSchedule[0]?.id ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your timetable."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const slot = schedule.find(s => s.id === selectedSlotId);
  const teacher: Teacher | null = user ? { id: user.id, name: user.name, email: user.email, classIds: Array.from(new Set<string>(schedule.map((s: ApiTimetableSlot) => s.subjectId))) } : null;
  const cls: ClassInfo | null = slot ? { id: slot.subjectId, name: slot.subjectName, teacherId: slot.teacherId, classGroup: slot.classGroup } : null;
  const roster = useMemo(() => students.filter(s => slot && s.section.toUpperCase() === slot.section.toUpperCase() && (!s.classGroup || s.classGroup === slot.classGroup)).filter(s => !query.trim() || s.name.toLowerCase().includes(query.trim().toLowerCase()) || s.id.toLowerCase().includes(query.trim().toLowerCase())), [students, slot, query]);
  const classRecords = useMemo(() => slot ? records.filter(r => r.classId === slot.subjectId && r.section.toUpperCase() === slot.section.toUpperCase() && r.classGroup === slot.classGroup) : [], [records, slot]);
  const todayMap = useMemo(() => new Map(classRecords.filter(r => r.date === todayLocal()).map(r => [r.studentId, r])), [classRecords]);
  const presentToday = [...todayMap.values()].filter(r => r.attendance === "Present").length;
  if (!user || !teacher) return null;
  return <AppShell>
    <section className="welcome"><p className="eyebrow">TEACHER WORKSPACE</p><h1>Welcome, {user.name}</h1><p className="muted">Your assigned timetable controls which subject and section you can take attendance for.</p></section>
    <section className="stats">
      <StatCard tone={online ? "green" : "orange"} icon={online ? <Wifi size={20}/> : <WifiOff size={20}/>} label="Connection" value={online ? "Online" : "Offline"}/>
      <StatCard tone="blue" icon={<CalendarDays size={20}/>} label="Assigned timetable slots" value={schedule.length}/>
      <StatCard tone="orange" icon={<Clock size={20}/>} label="Pending sync" value={counts.pending} note="Attendance records"/>
      <StatCard tone="green" icon={<CheckCircle2 size={20}/>} label="Present today" value={presentToday} note={slot ? `${slot.section} · ${slot.subjectName}` : "Select a class"}/>
    </section>
    {error && <div className="notice notice-error" role="alert">{error}<button className="btn btn-outline btn-sm" onClick={() => void load()} type="button">Retry</button></div>}
    <section className="card panel">
      <div className="panel-head"><div><h2><CalendarDays size={19}/> My weekly timetable</h2><p className="hint">Only admin-assigned classes appear here.</p></div><button type="button" className="btn btn-outline" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""}/> Refresh</button></div>
      {loading ? <div className="empty"><RefreshCw className="spin"/>Loading timetable…</div> : schedule.length === 0 ? <div className="empty"><CalendarDays size={28}/><strong>No classes assigned yet</strong><span>Ask the administrator to add your timetable in Academic Operations.</span></div> : <div className="table-wrap"><table className="student-table"><thead><tr><th>Day</th><th>Time</th><th>Subject</th><th>Class / section</th><th>Room</th></tr></thead><tbody>{[...schedule].sort((a,b)=>a.weekday-b.weekday || a.startsAt.localeCompare(b.startsAt)).map(s=><tr key={s.id}><td>{WEEKDAYS[s.weekday]}</td><td>{s.startsAt.slice(0,5)}–{s.endsAt.slice(0,5)}</td><td><strong>{s.subjectName}</strong><div className="muted small">{s.subjectId}</div></td><td>{s.classGroup}<div className="muted small">Section {s.section}</div></td><td>{s.room || "—"}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="card panel">
      <div className="panel-head"><div><h2><UserCheck size={19}/> Mark attendance</h2><p className="hint">Choose manual attendance or camera-assisted recognition for the selected timetable class.</p></div></div>
      {schedule.length > 0 && <label>Choose scheduled class<select value={selectedSlotId} onChange={e => { setSelectedSlotId(e.target.value); setNotice(null); }}><option value="">Choose a class</option>{schedule.map(s=><option key={s.id} value={s.id}>{WEEKDAYS[s.weekday]} · {s.subjectName} · {s.classGroup} / {s.section} · {s.startsAt.slice(0,5)}</option>)}</select></label>}
      {slot && cls ? <>
        <div className="mode-tabs" role="tablist" aria-label="Attendance method">
          <button type="button" role="tab" aria-selected={attendanceMode === "manual"} className={`tab ${attendanceMode === "manual" ? "active" : ""}`} onClick={() => setAttendanceMode("manual")}><UserCheck size={16}/> Manual attendance</button>
          <button type="button" role="tab" aria-selected={attendanceMode === "camera"} className={`tab ${attendanceMode === "camera" ? "active" : ""}`} onClick={() => setAttendanceMode("camera")}><ScanFace size={16}/> Camera attendance</button>
        </div>
        {attendanceMode === "camera" ? <BackendTeacherCameraPanel students={students.filter(s => s.section.toUpperCase() === slot.section.toUpperCase() && (!s.classGroup || s.classGroup === slot.classGroup)).map(s => ({ ...s, classGroup: slot.classGroup }))} cls={cls} teacher={teacher} section={slot.section} classGroup={slot.classGroup}/> : <>
          <label>Find a student</label><div className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name or student ID"/></div><div className="summary"><strong>{slot.subjectName}</strong><span className="muted small"> {slot.classGroup} · Section {slot.section} · {slot.room || "Room not set"}</span></div>
          {roster.length === 0 ? <div className="empty"><Users size={24}/><strong>No active students found for this class</strong><span>Check that students have the same class/group and section as the timetable.</span></div> : <ul className="roster">{roster.map(student => { const rec = todayMap.get(student.id); const studentModel: Student = { ...student, classGroup: slot.classGroup }; const clsModel: ClassInfo = { ...cls, classGroup: slot.classGroup }; return <li key={student.id}><span><strong>{student.name}</strong><span className="muted small"> {student.id} · Section {student.section}</span></span>{rec ? <span className="row-actions"><AttendanceBadge value={rec.attendance}/><StatusBadge status={rec.status}/></span> : <span className="row-actions"><button className="btn btn-primary btn-sm" type="button" onClick={() => setNotice(markAttendance(studentModel, clsModel, teacher))}>Mark present</button><button className="btn btn-outline btn-sm" type="button" onClick={() => setNotice(markAttendance(studentModel, clsModel, teacher, "Absent"))}><UserX size={14}/> Mark absent</button></span>}</li>; })}</ul>}
          <NoticeBox notice={notice}/>
        </>}
      </> : <div className="empty"><CalendarDays size={24}/><span>Select a scheduled class from your timetable to begin.</span></div>}
    </section>
    <div className="two-col wide-left"><SyncPanel/><section className="card panel"><h2>Selected class attendance history</h2>{slot ? <RecordsTable records={classRecords.slice(0,20)} emptyTitle="No attendance records yet" emptyText="Records for this class appear after attendance is marked and synced."/> : <p className="muted">Select a scheduled class to see its records.</p>}</section></div>
  </AppShell>;
}

export default function TeacherDashboard() {
  return hasBackend ? <BackendTeacherDashboard /> : <DemoTeacherDashboard />;
}
