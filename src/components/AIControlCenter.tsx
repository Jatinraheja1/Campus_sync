import { useEffect, useState, type FormEvent } from "react";
import { Activity, AlertTriangle, Bot, CalendarClock, CheckCircle2, ClipboardCheck, Plus, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { BACKEND_URL } from "../lib/api";
import { TOKEN_KEY } from "../lib/authToken";

type Teacher = { id: string; name: string; email?: string };
type Subject = { id: string; name: string };
type Slot = { id: string; classGroup: string; section: string; subjectId: string; subjectName: string; teacherId: string; teacherName?: string; weekday: number; startsAt: string; endsAt: string; room: string };
type Requirement = { classGroup: string; section: string; subjectId: string; teacherId: string; weeklySessions: number; durationMinutes: number; room: string };
type Generated = { id: string; classGroup: string; section: string; subjectId: string; subjectName?: string; teacherId: string; weekday: number; startsAt: string; endsAt: string; room: string };
type Change = Generated & { replacesId: string; original?: { weekday: number; startsAt: string; endsAt: string; teacherId: string; room: string } };
type Result = { ok?: boolean; valid?: boolean; conflictCount?: number; conflicts?: Array<{ type: string; message: string; slotIds: string[]; weekday?: number }>; error?: string; message?: string; generated?: Generated[]; changes?: Change[]; replaceSlotIds?: string[]; affectedCount?: number; nodes?: number; applied?: number; explanation?: string };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fresh = (): Requirement => ({ classGroup: "B.Tech CSE, Year 2", section: "A", subjectId: "", teacherId: "", weeklySessions: 2, durationMinutes: 60, room: "" });
async function api(path: string, init: RequestInit = {}) {
  if (!BACKEND_URL) throw new Error("Configure VITE_API_URL in .env and restart the frontend to enable AI tools.");
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${BACKEND_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export default function AIControlCenter() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([fresh()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"generate" | "recover" | "validate">("generate");
  const [generated, setGenerated] = useState<Generated[]>([]);
  const [replaceSlotIds, setReplaceSlotIds] = useState<string[]>([]);
  const [recovery, setRecovery] = useState<Result | null>(null);
  const [validation, setValidation] = useState<Result | null>(null);
  const [disruptionType, setDisruptionType] = useState<"teacher" | "room">("teacher");
  const [weekday, setWeekday] = useState(1);
  const [unavailableTeacherId, setUnavailableTeacherId] = useState("");
  const [substituteTeacherId, setSubstituteTeacherId] = useState("");
  const [unavailableRoom, setUnavailableRoom] = useState("");
  const [replacementRoom, setReplacementRoom] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [t, s, w] = await Promise.all([
        api("/admin/users?role=teacher&status=active&limit=100&offset=0"),
        api("/subjects"), api("/timetable")
      ]);
      const nextTeachers: Teacher[] = Array.isArray(t.users) ? t.users : [];
      const nextSubjects: Subject[] = Array.isArray(s.subjects) ? s.subjects : [];
      const nextSlots: Slot[] = Array.isArray(w.timetable) ? w.timetable : [];
      setTeachers(nextTeachers); setSubjects(nextSubjects); setSlots(nextSlots);
      setRequirements(old => old.map(r => ({ ...r, teacherId: r.teacherId || nextTeachers[0]?.id || "", subjectId: r.subjectId || nextSubjects[0]?.id || "" })));
      setUnavailableTeacherId(old => old || nextTeachers[0]?.id || "");
      setSubstituteTeacherId(old => old || nextTeachers.find(t => t.id !== (unavailableTeacherId || nextTeachers[0]?.id))?.id || "");
      setUnavailableRoom(old => old || nextSlots.find(s => s.room)?.room || "");
      setReplacementRoom(old => old || "Room 2");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load AI scheduling data."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const updateRequirement = (index: number, patch: Partial<Requirement>) =>
    setRequirements(old => old.map((r, i) => i === index ? { ...r, ...patch } : r));

  const generate = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError(""); setNotice(""); setGenerated([]); setReplaceSlotIds([]);
    try {
      const result: Result = await api("/ai/timetable/generate", { method: "POST", body: JSON.stringify({ requirements: requirements.map(r => ({ ...r, subjectName: subjects.find(s => s.id === r.subjectId)?.name || r.subjectId, weeklySessions: Number(r.weeklySessions), durationMinutes: Number(r.durationMinutes) })) }) });
      setGenerated(result.generated || []); setReplaceSlotIds(result.replaceSlotIds || []);
      setNotice(`${result.generated?.length || 0} class session(s) generated and validated. ${result.replaceSlotIds?.length || 0} existing slot(s) will be replaced after approval.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not generate a valid timetable."); }
    finally { setLoading(false); }
  };
  const applyGenerated = async () => {
    if (!generated.length) return;
    if (!window.confirm(`Apply ${generated.length} generated sessions and replace ${replaceSlotIds.length} existing slot(s) for these class sections?`)) return;
    setLoading(true); setError(""); setNotice("");
    try {
      const result = await api("/ai/timetable/apply", { method: "POST", body: JSON.stringify({ slots: generated, replaceSlotIds }) });
      setNotice(result.message || `${result.applied} sessions applied.`); setGenerated([]); setReplaceSlotIds([]); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply timetable."); }
    finally { setLoading(false); }
  };
  const validate = async () => {
    setLoading(true); setError(""); setNotice(""); setValidation(null);
    try { setValidation(await api("/ai/timetable/validate")); }
    catch (e) { setError(e instanceof Error ? e.message : "Validation failed."); }
    finally { setLoading(false); }
  };
  const makeRecovery = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError(""); setNotice(""); setRecovery(null);
    try {
      const result: Result = await api("/ai/timetable/recover", { method: "POST", body: JSON.stringify({
        disruptionType, weekday,
        ...(disruptionType === "teacher" ? { unavailableTeacherId, substituteTeacherId } : { unavailableRoom, replacementRoom })
      }) });
      setRecovery(result); setNotice(result.message || result.explanation || "Recovery preview ready.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not calculate recovery."); }
    finally { setLoading(false); }
  };
  const applyRecovery = async () => {
    if (!recovery?.changes?.length) return;
    if (!window.confirm(`Apply ${recovery.changes.length} recovery change(s)? The current schedule will be revalidated before any changes are saved.`)) return;
    setLoading(true); setError(""); setNotice("");
    try {
      const result = await api("/ai/timetable/recover/apply", { method: "POST", body: JSON.stringify({ changes: recovery.changes }) });
      setNotice(result.message || "Recovery applied."); setRecovery(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply recovery."); }
    finally { setLoading(false); }
  };
  const labelSlot = (s: { weekday: number; startsAt: string; endsAt: string; subjectId: string; subjectName?: string; section: string; room?: string }) =>
    `${DAYS[s.weekday]} ${s.startsAt}-${s.endsAt} · ${s.subjectName || s.subjectId} · Sec ${s.section}${s.room ? ` · ${s.room}` : ""}`;

  return <section className="card panel ai-control-center">
    <div className="panel-head ai-heading">
      <div><p className="eyebrow">CAMPUSSYNC INTELLIGENCE</p><h2><Sparkles size={21}/> AI Timetable & Recovery Center</h2><p className="hint">Generate a schedule, validate hard constraints, or recover from a disruption. Changes are previewed before saving.</p></div>
      <button type="button" className="btn btn-outline" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""}/> Refresh data</button>
    </div>
    <div className="ai-tabs" role="tablist" aria-label="AI timetable tools">
      <button type="button" className={tab === "generate" ? "active" : ""} onClick={() => setTab("generate")}><WandSparkles size={16}/> Generate timetable</button>
      <button type="button" className={tab === "recover" ? "active" : ""} onClick={() => setTab("recover")}><CalendarClock size={16}/> Recovery engine</button>
      <button type="button" className={tab === "validate" ? "active" : ""} onClick={() => { setTab("validate"); void validate(); }}><ClipboardCheck size={16}/> Validate schedule</button>
    </div>
    {error && <div className="notice notice-error" role="alert"><AlertTriangle size={17}/>{error}</div>}
    {notice && <div className="notice notice-info" role="status"><CheckCircle2 size={17}/>{notice}</div>}

    {tab === "generate" && <form onSubmit={generate} className="ai-form">
      <div className="ai-note"><Bot size={18}/><span>Set the weekly teaching requirements for each class/section. The solver keeps other sections' classes fixed, avoids teacher/section/room overlaps, and only replaces this section's existing slots after you approve.</span></div>
      {requirements.map((r, i) => <div className="ai-requirement" key={i}>
        <div className="ai-requirement-title"><strong>Class requirement {i + 1}</strong>{requirements.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRequirements(old => old.filter((_, idx) => idx !== i))}>Remove</button>}</div>
        <div className="ai-fields">
          <label>Class / group<input required value={r.classGroup} onChange={e => updateRequirement(i,{classGroup:e.target.value})}/></label>
          <label>Section<input required maxLength={20} value={r.section} onChange={e => updateRequirement(i,{section:e.target.value.toUpperCase()})}/></label>
          <label>Subject<select required value={r.subjectId} onChange={e => updateRequirement(i,{subjectId:e.target.value})}><option value="">Choose subject</option>{subjects.map(s=><option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}</select></label>
          <label>Teacher<select required value={r.teacherId} onChange={e => updateRequirement(i,{teacherId:e.target.value})}><option value="">Choose teacher</option>{teachers.map(t=><option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}</select></label>
          <label>Sessions / week<input type="number" min={1} max={6} required value={r.weeklySessions} onChange={e => updateRequirement(i,{weeklySessions:Number(e.target.value)})}/></label>
          <label>Session length<select value={r.durationMinutes} onChange={e => updateRequirement(i,{durationMinutes:Number(e.target.value)})}><option value={30}>30 minutes</option><option value={60}>60 minutes</option><option value={90}>90 minutes</option><option value={120}>120 minutes</option></select></label>
          <label>Room / lab<input value={r.room} onChange={e => updateRequirement(i,{room:e.target.value})} placeholder="e.g. Lab 2"/></label>
        </div>
      </div>)}
      <div className="ai-actions"><button type="button" className="btn btn-outline" onClick={() => setRequirements(old => [...old, fresh()])} disabled={requirements.length >= 40}><Plus size={16}/> Add requirement</button><button className="btn btn-primary" disabled={loading || !teachers.length || !subjects.length}><WandSparkles size={16}/>{loading ? "Solving constraints…" : "Generate valid timetable"}</button></div>
      {generated.length > 0 && <div className="ai-result">
        <div className="panel-head"><h3><CheckCircle2 size={18}/> Generated preview</h3><span className="badge badge-green">{generated.length} sessions</span></div>
        {replaceSlotIds.length > 0 && <p className="hint">Approval will replace {replaceSlotIds.length} existing slot(s) for the selected class/section. Other classes stay unchanged.</p>}
        <div className="table-wrap"><table><thead><tr><th>Day</th><th>Time</th><th>Section</th><th>Subject</th><th>Teacher ID</th><th>Room</th></tr></thead><tbody>{generated.slice().sort((a,b)=>a.weekday-b.weekday||a.startsAt.localeCompare(b.startsAt)).map(s=><tr key={s.id}><td>{DAYS[s.weekday]}</td><td>{s.startsAt}–{s.endsAt}</td><td>{s.section}</td><td>{s.subjectName || s.subjectId}</td><td>{s.teacherId}</td><td>{s.room || "—"}</td></tr>)}</tbody></table></div>
        <button type="button" className="btn btn-primary" onClick={() => void applyGenerated()} disabled={loading}>Approve & apply timetable</button>
      </div>}
    </form>}

    {tab === "recover" && <form onSubmit={makeRecovery} className="ai-form">
      <div className="ai-note"><Activity size={18}/><span>The recovery engine proposes the smallest practical schedule changes it can find, preserves unaffected classes, then validates the entire proposed timetable before it can be applied.</span></div>
      <div className="ai-fields">
        <label>Disruption type<select value={disruptionType} onChange={e => setDisruptionType(e.target.value as "teacher"|"room")}><option value="teacher">Teacher unavailable</option><option value="room">Room unavailable</option></select></label>
        <label>Day<select value={weekday} onChange={e => setWeekday(Number(e.target.value))}>{[1,2,3,4,5].map(d=><option key={d} value={d}>{DAYS[d]}</option>)}</select></label>
        {disruptionType === "teacher" ? <>
          <label>Unavailable teacher<select required value={unavailableTeacherId} onChange={e => {setUnavailableTeacherId(e.target.value); if(e.target.value===substituteTeacherId)setSubstituteTeacherId(teachers.find(t=>t.id!==e.target.value)?.id||"");}}><option value="">Choose teacher</option>{teachers.map(t=><option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}</select></label>
          <label>Substitute teacher<select required value={substituteTeacherId} onChange={e => setSubstituteTeacherId(e.target.value)}><option value="">Choose substitute</option>{teachers.filter(t=>t.id!==unavailableTeacherId).map(t=><option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}</select></label>
        </> : <>
          <label>Unavailable room<select required value={unavailableRoom} onChange={e => setUnavailableRoom(e.target.value)}><option value="">Choose room</option>{[...new Set(slots.map(s=>s.room).filter(Boolean))].map(r=><option key={r} value={r}>{r}</option>)}</select></label>
          <label>Replacement room<input required value={replacementRoom} onChange={e => setReplacementRoom(e.target.value)} placeholder="Enter available room"/></label>
        </>}
      </div>
      <div className="ai-actions"><button className="btn btn-primary" disabled={loading || !slots.length}><CalendarClock size={16}/>{loading ? "Finding recovery…" : "Find minimum-disruption plan"}</button></div>
      {recovery?.changes && <div className="ai-result">
        <div className="panel-head"><h3>Recovery preview</h3><span className="badge badge-green">{recovery.changes.length} proposed changes</span></div>
        <p className="hint">{recovery.explanation}</p>
        <div className="table-wrap"><table><thead><tr><th>Class</th><th>Before</th><th>Proposed</th><th>New teacher</th><th>Room</th></tr></thead><tbody>{recovery.changes.map(c=><tr key={c.replacesId}><td>{c.subjectName || c.subjectId} · Sec {c.section}</td><td>{c.original ? `${DAYS[c.original.weekday]} ${c.original.startsAt}-${c.original.endsAt}` : c.replacesId}</td><td>{labelSlot(c)}</td><td>{c.teacherId}</td><td>{c.room || "—"}</td></tr>)}</tbody></table></div>
        <button type="button" className="btn btn-primary" onClick={() => void applyRecovery()} disabled={loading}>Approve & apply recovery</button>
      </div>}
    </form>}

    {tab === "validate" && <div className="ai-result">
      {validation ? <>
        <div className="validation-summary"><span className={`validation-icon ${validation.valid ? "valid" : "invalid"}`}>{validation.valid ? <CheckCircle2 size={24}/> : <AlertTriangle size={24}/>}</span><div><h3>{validation.valid ? "No conflicts detected" : `${validation.conflictCount || validation.conflicts?.length || 0} conflict(s) found`}</h3><p className="hint">Checked {slots.length} active timetable entries for teacher, section and room overlap.</p></div></div>
        {!validation.valid && <ul className="conflict-list">{validation.conflicts?.map((c,i)=><li key={`${c.type}-${i}`}><strong>{c.type}</strong> · {c.message} {c.weekday !== undefined ? `(${DAYS[c.weekday]})` : ""}<small>{c.slotIds.join(" ↔ ")}</small></li>)}</ul>}
      </> : <p className="muted">Run validation to check the active timetable.</p>}
      <button type="button" className="btn btn-outline" onClick={() => void validate()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""}/> Run validation</button>
    </div>}
    <p className="hint ai-footnote">Scheduling currently uses Monday–Friday, 09:00–17:00, with a 12:00–13:00 lunch break. It never applies a preview automatically. Add more capacity or revise requirements if the solver reports that no valid schedule exists.</p>
  </section>;
}
