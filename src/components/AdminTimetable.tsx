import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarDays, Clock3, Edit2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { BACKEND_URL } from "../lib/api";
import { TOKEN_KEY } from "../lib/authToken";

type TeacherOption = { id: string; name: string; email: string };
type SubjectOption = { id: string; name: string };
type Slot = { id: string; classGroup: string; section: string; subjectId: string; subjectName: string; teacherId: string; teacherName: string; weekday: number; startsAt: string; endsAt: string; room: string };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fresh = { teacherId: "", classGroup: "B.Tech CSE, Year 2", section: "A", subjectId: "", subjectName: "", newSubjectId: "", weekday: 1, startsAt: "09:00", endsAt: "10:00", room: "" };
async function request(path: string, init: RequestInit = {}) {
  if (!BACKEND_URL) throw new Error("Backend is not enabled. Configure VITE_API_URL and restart Vite.");
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${BACKEND_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}
export default function AdminTimetable() {
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [form, setForm] = useState(fresh);
  const [newSubject, setNewSubject] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [t, s, w] = await Promise.all([
        request("/admin/users?role=teacher&status=active&limit=100&offset=0"),
        request("/subjects"), request("/timetable")
      ]);
      const activeTeachers = Array.isArray(t.users) ? t.users : [];
      const loadedSubjects = Array.isArray(s.subjects) ? s.subjects : [];
      setTeachers(activeTeachers); setSubjects(loadedSubjects); setSlots(Array.isArray(w.timetable) ? w.timetable : []);
      setForm(old => ({ ...old, teacherId: old.teacherId || activeTeachers[0]?.id || "", subjectId: old.subjectId || loadedSubjects[0]?.id || "" }));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load academic setup."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const subjectId = newSubject ? form.newSubjectId.trim() : form.subjectId;
      if (!subjectId) throw new Error("Choose a subject or enter a new subject ID.");
      const id = editingId || `TT-${form.teacherId}-${subjectId}-${form.section}-${form.weekday}-${form.startsAt.replace(":", "")}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
      await request("/admin/timetable", { method: "POST", body: JSON.stringify({ id, classGroup: form.classGroup.trim(), section: form.section.trim().toUpperCase(), subjectId, ...(newSubject ? { subjectName: form.subjectName.trim() } : {}), teacherId: form.teacherId, weekday: Number(form.weekday), startsAt: form.startsAt, endsAt: form.endsAt, room: form.room.trim() }) });
      setMessage("Timetable saved. The subject is now assigned to this teacher.");
      setForm(old => ({ ...fresh, teacherId: old.teacherId, subjectId: subjectId, newSubjectId: "", subjectName: "" })); setNewSubject(false); setEditingId(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save timetable."); }
    finally { setSaving(false); }
  };
  const startEdit = (slot: Slot) => {
    setEditingId(slot.id); setNewSubject(false); setError(""); setMessage("");
    setForm({ ...fresh, teacherId: slot.teacherId, classGroup: slot.classGroup, section: slot.section, subjectId: slot.subjectId, weekday: slot.weekday, startsAt: slot.startsAt.slice(0,5), endsAt: slot.endsAt.slice(0,5), room: slot.room || "" });
  };
  const remove = async (slot: Slot) => {
    if (!window.confirm(`Remove ${slot.subjectName} for ${slot.teacherName}, Section ${slot.section}, ${DAYS[slot.weekday]}?`)) return;
    setError(""); setMessage("");
    if (editingId === slot.id) { setEditingId(null); setForm(fresh); setNewSubject(false); }
    try { await request(`/admin/timetable/${encodeURIComponent(slot.id)}`, { method: "DELETE" }); setMessage("Timetable slot removed."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not remove timetable slot."); }
  };
  return <section className="card panel academic-panel">
    <div className="panel-head"><div><p className="eyebrow">ACADEMIC OPERATIONS</p><h2><CalendarDays size={20}/> Teacher timetable & class assignment</h2><p className="hint">Create a weekly class schedule. Saving a slot also assigns that subject to the teacher.</p></div><button type="button" className="btn btn-outline" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""}/> Refresh</button></div>
    {message && <div className="notice notice-success" role="status">{message}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    {teachers.length === 0 && !loading && <div className="notice notice-info">Create an active teacher account in User Management before adding timetable slots.</div>}
    <form className="student-form" onSubmit={submit}>
      <h3><Plus size={17}/> {editingId ? `Edit timetable slot · ${editingId}` : "Add a timetable slot"}</h3>
      <div className="student-form-grid">
        <label>Teacher<select required value={form.teacherId} onChange={e => setForm({ ...form, teacherId: e.target.value })}><option value="">Choose teacher</option>{teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}</select></label>
        <label>Subject<select value={newSubject ? "__new__" : form.subjectId} onChange={e => { if (e.target.value === "__new__") setNewSubject(true); else { setNewSubject(false); setForm({ ...form, subjectId: e.target.value }); } }}><option value="">Choose subject</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}<option value="__new__">+ Create a new subject</option></select></label>
        {newSubject && <><label>New subject ID<input required value={form.newSubjectId} onChange={e => setForm({ ...form, newSubjectId: e.target.value.toUpperCase() })} placeholder="e.g. MAT101" pattern="[A-Za-z0-9_-]+"/></label><label>New subject name<input required minLength={2} value={form.subjectName} onChange={e => setForm({ ...form, subjectName: e.target.value })} placeholder="e.g. Mathematics"/></label></>}
        <label>Class / group<input required value={form.classGroup} onChange={e => setForm({ ...form, classGroup: e.target.value })} placeholder="e.g. B.Tech CSE, Year 2"/></label>
        <label>Section<input required maxLength={20} value={form.section} onChange={e => setForm({ ...form, section: e.target.value.toUpperCase() })} placeholder="A"/></label>
        <label>Day<select value={form.weekday} onChange={e => setForm({ ...form, weekday: Number(e.target.value) })}>{DAYS.map((d, i) => <option value={i} key={d}>{d}</option>)}</select></label>
        <label>Room / lab<input value={form.room} onChange={e => setForm({ ...form, room: e.target.value })} placeholder="e.g. Lab 2"/></label>
        <label>Start time<input type="time" required value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })}/></label>
        <label>End time<input type="time" required value={form.endsAt} onChange={e => setForm({ ...form, endsAt: e.target.value })}/></label>
      </div>
      <div className="student-form-actions"><button className="btn btn-primary" type="submit" disabled={saving || loading || teachers.length === 0}><Plus size={16}/>{saving ? "Saving timetable…" : editingId ? "Save changes" : "Save timetable slot"}</button>{editingId && <button className="btn btn-outline" type="button" onClick={() => { setEditingId(null); setForm(fresh); setNewSubject(false); }}>Cancel edit</button>}</div>
    </form>
    <div className="panel-head"><h3>Saved timetable</h3><span className="badge badge-blue">{slots.length} slots</span></div>
    {loading ? <div className="empty"><RefreshCw size={20} className="spin"/>Loading timetable…</div> : slots.length === 0 ? <div className="empty"><CalendarDays size={28}/><strong>No timetable slots yet</strong><span>Add the first slot above.</span></div> : <div className="table-wrap"><table className="student-table"><thead><tr><th>Day / time</th><th>Class</th><th>Subject</th><th>Teacher</th><th>Room</th><th>Actions</th></tr></thead><tbody>{[...slots].sort((a,b)=>a.weekday-b.weekday || a.startsAt.localeCompare(b.startsAt)).map(slot=><tr key={slot.id}><td><strong>{DAYS[slot.weekday]}</strong><div className="muted small"><Clock3 size={12} style={{display:"inline"}}/> {slot.startsAt.slice(0,5)}–{slot.endsAt.slice(0,5)}</div></td><td>{slot.classGroup}<div className="muted small">Section {slot.section}</div></td><td><strong>{slot.subjectName}</strong><div className="muted small">{slot.subjectId}</div></td><td>{slot.teacherName}<div className="muted small">{slot.teacherId}</div></td><td>{slot.room || "—"}</td><td><div className="student-row-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => startEdit(slot)}><Edit2 size={14}/> Edit</button><button type="button" className="btn btn-outline btn-sm" onClick={() => void remove(slot)}><Trash2 size={14}/> Remove</button></div></td></tr>)}</tbody></table></div>}
    <p className="hint">A teacher can mark attendance only for assigned subjects. Students are matched by the section selected in this timetable. Check class group and section names carefully before saving.</p>
  </section>;
}
