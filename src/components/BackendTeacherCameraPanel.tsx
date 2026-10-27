import { useMemo, useState } from "react";
import { AlertTriangle, CheckCheck, Loader2, Save, ScanFace } from "lucide-react";
import CameraCapture from "./CameraCapture";
import NoticeBox from "./NoticeBox";
import { useAttendance } from "../context/AttendanceContext";
import { useEnrollments } from "../hooks/useEnrollments";
import { detectFaces, faceSharpness, faceThumbnail, MODEL_NAME, type RawFace } from "../lib/face";
import { DEFAULT_SETTINGS, classify, distance, matchScore, type ClassifiedFace } from "../lib/recognition";
import { todayLocal } from "../lib/utils";
import type { ClassInfo, Notice, Student, Teacher } from "../types";

type ReviewFace = ClassifiedFace & { assignedId: string | null };
type Decision = "present" | "absent";
type Stage = "idle" | "processing" | "done";
const THRESHOLD_KEY = "smartattend.recognition.threshold";
function loadThreshold(): number {
  try { const v = Number(localStorage.getItem(THRESHOLD_KEY)); return v >= 0.35 && v <= 0.65 ? v : DEFAULT_SETTINGS.threshold; }
  catch { return DEFAULT_SETTINGS.threshold; }
}
const STATUS_CLASS = { matched: "badge-green", review: "badge-orange", unrecognized: "badge-red", none: "badge-grey" } as const;

/** Camera-assisted attendance for the timetable-backed teacher portal. Teacher confirms all proposed results before saving. */
export default function BackendTeacherCameraPanel({ students, cls, teacher, section, classGroup }: {
  students: Student[]; cls: ClassInfo; teacher: Teacher; section: string; classGroup: string;
}) {
  const { records, saveBatch } = useAttendance();
  const { enrollments, error: enrollError } = useEnrollments();
  const [date, setDate] = useState(todayLocal());
  const [threshold, setThreshold] = useState(loadThreshold);
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState("");
  const [faces, setFaces] = useState<ReviewFace[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const roster = useMemo(() => students.filter(s => s.section.toUpperCase() === section.toUpperCase() && (!s.classGroup || s.classGroup === classGroup)), [students, section, classGroup]);
  const existing = useMemo(() => new Set(records.filter(r => r.classId === cls.id && r.classGroup === classGroup && r.section.toUpperCase() === section.toUpperCase() && r.date === date).map(r => r.studentId)), [records, cls.id, classGroup, section, date]);
  const assigned = useMemo(() => { const m = new Map<string, number>(); faces.forEach((f, i) => { if (f.assignedId) m.set(f.assignedId, i); }); return m; }, [faces]);
  const unenrolled = roster.filter(s => !enrollments.has(s.id));
  const resetResults = () => { setStage("idle"); setFaces([]); setDecisions({}); setNotice(null); };
  const distTo = (f: RawFace, studentId: string): number | null => {
    const e = enrollments.get(studentId);
    return !e || !e.descriptors.length ? null : Math.min(...e.descriptors.map(d => distance(f.descriptor, d)));
  };
  const recognize = async () => {
    if (!photo) return;
    resetResults(); setStage("processing");
    try {
      setProgress("Loading face models from local files…");
      const raw = await detectFaces(photo, { tile: true, onProgress: setProgress });
      setProgress("Matching faces against enrolled students…");
      const prepared = raw.map(f => ({ ...f, sharpness: faceSharpness(photo, f.box), thumb: faceThumbnail(photo, f.box) }));
      const enrolled = roster.filter(s => enrollments.has(s.id)).map(s => ({ studentId: s.id, descriptors: enrollments.get(s.id)!.descriptors }));
      const result = classify(prepared, enrolled, { ...DEFAULT_SETTINGS, threshold });
      setFaces(result.map(f => ({ ...f, assignedId: f.status === "matched" ? f.candidates[0].studentId : null })));
      setStage("done");
    } catch (e) {
      setStage("idle"); setNotice({ kind: "error", text: e instanceof Error ? e.message : "Face recognition failed. You can still use manual attendance." });
    }
  };
  const assignFace = (i: number, studentId: string) => setFaces(prev => prev.map((f, k) => k === i ? { ...f, assignedId: studentId || null } : f));
  const setDecision = (id: string, v: Decision | undefined) => setDecisions(prev => { const next = { ...prev }; if (v) next[id] = v; else delete next[id]; return next; });
  const confirmMatched = () => setDecisions(prev => { const next = { ...prev }; roster.forEach(s => { if (assigned.has(s.id) && !existing.has(s.id) && !next[s.id]) next[s.id] = "present"; }); return next; });
  const toSave = roster.filter(s => decisions[s.id] && !existing.has(s.id));
  const save = () => {
    if (!toSave.length) return;
    const res = saveBatch(toSave.map(s => {
      const fi = assigned.get(s.id); const present = decisions[s.id] === "present";
      const d = present && fi !== undefined ? distTo(faces[fi], s.id) : null;
      const student: Student = { ...s, classGroup };
      return { student, cls: { ...cls, classGroup }, teacher, date, attendance: present ? "Present" as const : "Absent" as const, source: present && fi !== undefined ? "face" as const : "manual" as const, matchScore: d === null ? undefined : matchScore(d) };
    }));
    setPhoto(null); setResetKey(k => k + 1); resetResults();
    setNotice({ kind: res.saved ? "success" : "error", text: `${res.saved} confirmed attendance record(s) saved on this device as Pending Sync${res.skipped.length ? `. Already recorded: ${res.skipped.join(", ")}` : ""}${res.locked.length ? `. Locked session: ${res.locked.join(", ")}` : ""}. Sync to upload records to the backend.` });
  };
  const counts = { matched: faces.filter(f => f.status === "matched").length, review: faces.filter(f => f.status === "review").length, unrecognized: faces.filter(f => f.status === "unrecognized").length };
  const faceView = faces.map((f, i) => ({ f, i })).sort((a, b) => ({ review: 0, unrecognized: 1, matched: 2 }[a.f.status] - { review: 0, unrecognized: 1, matched: 2 }[b.f.status]));

  return <section className="card panel" aria-labelledby="teacher-camera-title">
    <h3 id="teacher-camera-title"><ScanFace size={18}/> Camera-assisted attendance</h3>
    <p className="hint">Selected class: {cls.name} · {classGroup}, Section {section}. Recognition runs locally in this browser. Review every result before saving; uncertain faces must be checked manually.</p>
    <label htmlFor="teacher-camera-date">Attendance date</label>
    <input id="teacher-camera-date" type="date" value={date} max={todayLocal()} onChange={e => { setDate(e.target.value || todayLocal()); resetResults(); }} />
    {enrollError && <div className="notice notice-error" role="alert">{enrollError}</div>}
    {unenrolled.length > 0 && <div className="notice notice-info"><AlertTriangle size={17}/><span>{unenrolled.length} student(s) in this class do not have face samples enrolled. They cannot be recognized until an administrator enrolls them; verify these students manually.</span></div>}
    <CameraCapture key={resetKey} onChange={c => { setPhoto(c); resetResults(); }} captureLabel="Capture class photo" facing="environment" />
    <div className="threshold"><label htmlFor="teacher-camera-threshold">Match strictness: {threshold.toFixed(2)}</label><input id="teacher-camera-threshold" type="range" min={0.35} max={0.65} step={0.01} value={threshold} onChange={e => { const v = Number(e.target.value); setThreshold(v); try { localStorage.setItem(THRESHOLD_KEY, String(v)); } catch { /* ignore */ } }}/><p className="hint">Lower values are stricter. Adjustments apply the next time you recognize the photo.</p></div>
    <button className="btn btn-primary btn-lg" type="button" onClick={() => void recognize()} disabled={!photo || stage === "processing" || roster.length === 0}>{stage === "processing" ? <Loader2 size={17} className="spin"/> : <ScanFace size={17}/>} {stage === "processing" ? "Recognizing…" : "Recognize students"}</button>
    {stage === "processing" && <p className="hint" role="status">{progress}</p>}
    <NoticeBox notice={notice}/>
    {stage === "done" && <>
      {faces.length === 0 ? <div className="notice notice-error"><AlertTriangle size={17}/> No faces detected. Retake with good lighting or mark attendance manually.</div> : <p className="summary"><strong>{faces.length}</strong> faces detected: {counts.matched} matched, {counts.review} need review, {counts.unrecognized} unrecognized.</p>}
      {faces.length > 0 && <div className="face-grid">{faceView.map(({ f, i }) => <div key={i} className="face-card"><img src={f.thumb} alt={`Detected face ${i + 1}`}/><div><span className={`badge ${STATUS_CLASS[f.status]}`}>{f.status === "matched" ? "Matched — review" : f.status === "review" ? "Needs review" : "Unrecognized"}</span><p className="small muted">{f.reason}</p><select aria-label={`Assign detected face ${i + 1}`} value={f.assignedId ?? ""} onChange={e => assignFace(i, e.target.value)}><option value="">Not assigned</option>{roster.map(s => { const other = assigned.get(s.id); return <option key={s.id} value={s.id} disabled={other !== undefined && other !== i}>{s.name} ({s.id}){other !== undefined && other !== i ? " — already assigned" : ""}</option>; })}</select></div></div>)}</div>}
      <div className="panel-head"><h3>Review attendance</h3><button className="btn btn-outline" type="button" onClick={confirmMatched} disabled={!roster.some(s => assigned.has(s.id) && !existing.has(s.id))}><CheckCheck size={16}/> Confirm matched as Present</button></div>
      <div className="table-wrap"><table><thead><tr><th>Student</th><th>Face result</th><th>Attendance decision</th></tr></thead><tbody>{roster.map(s => { const fi = assigned.get(s.id); const f = fi === undefined ? undefined : faces[fi]; const already = existing.has(s.id); return <tr key={s.id}><td><strong>{s.name}</strong><div className="muted small">{s.id}</div></td><td>{already ? "Already recorded" : f ? `${f.status === "matched" ? "Matched" : f.status === "review" ? "Needs review" : "Unrecognized"}${f.candidates[0] ? ` · distance ${f.candidates[0].distance.toFixed(2)}` : ""}` : "Not detected"}</td><td>{already ? <span className="badge badge-grey">Already recorded</span> : <div className="seg"><button type="button" className={`seg-btn ${decisions[s.id] === "present" ? "on-blue" : ""}`} onClick={() => setDecision(s.id, decisions[s.id] === "present" ? undefined : "present")}>Present</button><button type="button" className={`seg-btn ${decisions[s.id] === "absent" ? "on-red" : ""}`} onClick={() => setDecision(s.id, decisions[s.id] === "absent" ? undefined : "absent")}>Absent</button></div>}</td></tr>; })}</tbody></table></div>
      <p className="hint">Only decisions you confirm are saved. Unmarked students remain unrecorded. The original class photo is not stored.</p>
      <button className="btn btn-primary btn-lg" type="button" onClick={save} disabled={!toSave.length}><Save size={17}/> Save {toSave.length} confirmed record(s)</button>
    </>}
    <details className="about"><summary>About camera attendance</summary><p>Model: {MODEL_NAME}. Face samples are stored in this browser's IndexedDB. Camera matching is only a suggestion and can make mistakes; teacher verification is required before saving attendance.</p></details>
  </section>;
}
