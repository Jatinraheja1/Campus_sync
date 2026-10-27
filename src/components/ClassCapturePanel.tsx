import { useMemo, useState } from "react";
import { AlertTriangle, CheckCheck, Loader2, Save, ScanFace } from "lucide-react";
import CameraCapture from "./CameraCapture";
import NoticeBox from "./NoticeBox";
import { useAttendance } from "../context/AttendanceContext";
import { useConnectivity } from "../context/ConnectivityContext";
import { useEnrollments } from "../hooks/useEnrollments";
import { detectFaces, faceSharpness, faceThumbnail, MODEL_NAME, type RawFace } from "../lib/face";
import { DEFAULT_SETTINGS, classify, distance, matchScore, type ClassifiedFace } from "../lib/recognition";
import { CLASSES, CLASS_GROUP, SECTIONS, STUDENTS } from "../lib/users";
import { todayLocal } from "../lib/utils";
import type { Notice, Teacher } from "../types";

type ReviewFace = ClassifiedFace & { assignedId: string | null };
type Decision = "present" | "absent";
type Stage = "idle" | "processing" | "done" | "error";

const THRESHOLD_KEY = "smartattend.recognition.threshold";
function loadThreshold(): number {
  try {
    const v = Number(localStorage.getItem(THRESHOLD_KEY));
    return v >= 0.35 && v <= 0.65 ? v : DEFAULT_SETTINGS.threshold;
  } catch { return DEFAULT_SETTINGS.threshold; }
}

const STATUS_LABEL = {
  matched: "Matched — Present Pending Confirmation",
  review: "Needs Review",
  unrecognized: "Unrecognized",
  none: "Not Detected — Unconfirmed",
} as const;
const STATUS_CLASS = { matched: "badge-green", review: "badge-orange", unrecognized: "badge-red", none: "badge-grey" } as const;

export default function ClassCapturePanel({ teacher }: { teacher: Teacher }) {
  const { records, saveBatch } = useAttendance();
  const { online } = useConnectivity();
  const { enrollments, error: enrollError } = useEnrollments();

  const subjects = useMemo(() => CLASSES.filter((c) => teacher.classIds.includes(c.id)), [teacher]);
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [section, setSection] = useState(SECTIONS[0]);
  const [date, setDate] = useState(todayLocal());
  const [threshold, setThreshold] = useState(loadThreshold);

  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState("");
  const [faces, setFaces] = useState<ReviewFace[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [notice, setNotice] = useState<Notice | null>(null);

  const subject = subjects.find((c) => c.id === subjectId);
  const roster = useMemo(() => STUDENTS.filter((s) => s.section === section), [section]);
  const unenrolled = roster.filter((s) => !enrollments.has(s.id));
  const existing = useMemo(
    () => new Set(records.filter((r) => r.classId === subjectId && r.date === date).map((r) => r.studentId)),
    [records, subjectId, date]
  );
  const assigned = useMemo(() => {
    const m = new Map<string, number>();
    faces.forEach((f, i) => { if (f.assignedId) m.set(f.assignedId, i); });
    return m;
  }, [faces]);

  const resetResults = () => { setStage("idle"); setFaces([]); setDecisions({}); setNotice(null); };

  const distTo = (f: RawFace, studentId: string): number | null => {
    const e = enrollments.get(studentId);
    if (!e || e.descriptors.length === 0) return null;
    return Math.min(...e.descriptors.map((d) => distance(f.descriptor, d)));
  };

  const recognize = async () => {
    if (!photo) return;
    resetResults();
    setStage("processing");
    try {
      setProgress("Loading face models from local files…");
      const raw = await detectFaces(photo, { tile: true, onProgress: setProgress });
      setProgress("Matching faces to enrolled students…");
      const prepared = raw.map((f) => ({ ...f, sharpness: faceSharpness(photo, f.box), thumb: faceThumbnail(photo, f.box) }));
      const enrolled = roster.filter((s) => enrollments.has(s.id)).map((s) => ({ studentId: s.id, descriptors: enrollments.get(s.id)!.descriptors }));
      const classified = classify(prepared, enrolled, { ...DEFAULT_SETTINGS, threshold });
      setFaces(classified.map((f) => ({ ...f, assignedId: f.status === "matched" ? f.candidates[0].studentId : null })));
      setStage("done");
    } catch (e) {
      setStage("error");
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "Recognition failed." });
    }
  };

  const assignFace = (i: number, studentId: string) =>
    setFaces((prev) => prev.map((f, k) => (k === i ? { ...f, assignedId: studentId || null } : f)));

  const setDecision = (id: string, v: Decision | undefined) =>
    setDecisions((prev) => { const n = { ...prev }; if (v) n[id] = v; else delete n[id]; return n; });

  const confirmMatched = () =>
    setDecisions((prev) => {
      const n = { ...prev };
      roster.forEach((s) => { if (assigned.has(s.id) && !existing.has(s.id) && !n[s.id]) n[s.id] = "present"; });
      return n;
    });

  const toSave = roster.filter((s) => decisions[s.id] && !existing.has(s.id));

  const save = () => {
    if (!subject || toSave.length === 0) return;
    const res = saveBatch(toSave.map((s) => {
      const fi = assigned.get(s.id);
      const present = decisions[s.id] === "present";
      const d = present && fi !== undefined ? distTo(faces[fi], s.id) : null;
      return { student: s, cls: subject, teacher, date, attendance: present ? "Present" as const : "Absent" as const, source: present && fi !== undefined ? "face" as const : "manual" as const, matchScore: d === null ? undefined : matchScore(d) };
    }));
    setPhoto(null); setResetKey((k) => k + 1); resetResults();
    setNotice({
      kind: res.saved ? "success" : "error",
      text: `${res.saved} confirmed record(s) saved on this device as Pending Sync${res.skipped.length ? `. Skipped (already recorded): ${res.skipped.join(", ")}` : ""}${res.locked.length ? `. Not saved, class already finalized or cancelled: ${res.locked.join(", ")}` : ""}${res.notEnrolled.length ? `. Not saved, not enrolled on this date: ${res.notEnrolled.join(", ")}` : ""}. The photo was discarded.`,
    });
  };

  const counts = {
    matched: faces.filter((f) => f.status === "matched").length,
    review: faces.filter((f) => f.status === "review").length,
    unrecognized: faces.filter((f) => f.status === "unrecognized").length,
  };
  const order = { review: 0, unrecognized: 1, matched: 2 } as const;
  const faceView = faces.map((f, i) => ({ f, i })).sort((a, b) => order[a.f.status] - order[b.f.status]);

  if (!subject) return <div className="notice notice-error">No subjects are assigned to this teacher.</div>;

  return (
    <section className="card panel" aria-labelledby="capture-title">
      <h2 id="capture-title"><ScanFace size={18} /> Capture whole class</h2>
      <p className="hint">
        {online ? "Online." : "Offline."} Face detection and matching run in this browser using local model files{online ? "" : ", so this still works without internet"}.
        Nothing is saved as attendance until you confirm it below.
      </p>

      <div className="selectors">
        <div><label htmlFor="cg">Class</label><select id="cg" value={CLASS_GROUP} disabled><option>{CLASS_GROUP}</option></select></div>
        <div><label htmlFor="sec">Section</label>
          <select id="sec" value={section} onChange={(e) => { setSection(e.target.value); resetResults(); }}>{SECTIONS.map((s) => <option key={s} value={s}>Section {s}</option>)}</select></div>
        <div><label htmlFor="sub">Subject</label>
          <select id="sub" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); resetResults(); }}>{subjects.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}</select></div>
        <div><label htmlFor="dt">Attendance date</label>
          <input id="dt" type="date" value={date} max={todayLocal()} onChange={(e) => { setDate(e.target.value || todayLocal()); resetResults(); }} /></div>
      </div>

      {enrollError && <div className="notice notice-error" role="alert">{enrollError}</div>}
      {unenrolled.length > 0 && (
        <div className="notice notice-info"><AlertTriangle size={18} /><span>
          Not enrolled for face recognition in Section {section}: {unenrolled.map((s) => s.name).join(", ")}. They cannot be recognized and must be confirmed manually. An administrator can enroll them.
        </span></div>
      )}

      <CameraCapture key={resetKey} onChange={(c) => { setPhoto(c); resetResults(); }} captureLabel="Capture class photo" facing="environment" />

      <div className="threshold">
        <label htmlFor="thr">Match strictness: distance threshold {threshold.toFixed(2)}</label>
        <input id="thr" type="range" min={0.35} max={0.65} step={0.01} value={threshold}
          onChange={(e) => { const v = Number(e.target.value); setThreshold(v); try { localStorage.setItem(THRESHOLD_KEY, String(v)); } catch { /* ignore */ } }} />
        <p className="hint">Lower = stricter (fewer wrong matches, more “Needs Review”). Applied the next time you press Recognize.</p>
      </div>

      <button className="btn btn-primary btn-lg" onClick={() => void recognize()} disabled={!photo || stage === "processing"}>
        {stage === "processing" ? <Loader2 size={18} className="spin" /> : <ScanFace size={18} />} {stage === "processing" ? "Processing…" : "Recognize students"}
      </button>
      {stage === "processing" && <p className="hint" role="status">{progress}</p>}
      <NoticeBox notice={notice} />

      {stage === "done" && (
        <>
          {faces.length === 0 ? (
            <div className="notice notice-error" role="alert"><AlertTriangle size={18} /><span>No faces were detected in this photo. Retake it with better light, all students facing the camera, and faces large enough in the frame. You can still confirm attendance manually below.</span></div>
          ) : (
            <p className="summary"><strong>{faces.length}</strong> faces detected: {counts.matched} matched, {counts.review} need review, {counts.unrecognized} unrecognized.</p>
          )}

          {faces.length > 0 && (
            <div className="face-grid">
              {faceView.map(({ f, i }) => {
                const best = f.candidates[0];
                const bestStudent = best ? STUDENTS.find((s) => s.id === best.studentId) : undefined;
                return (
                  <div key={i} className="face-card">
                    <img src={f.thumb} alt={`Detected face ${i + 1}`} />
                    <div>
                      <span className={`badge ${STATUS_CLASS[f.status]}`}>{f.status === "matched" ? "Matched" : f.status === "review" ? "Needs Review" : "Unrecognized"}</span>
                      <p className="small muted">{f.reason}</p>
                      {bestStudent && best && <p className="small">Closest: {bestStudent.name} (score {Math.round(matchScore(best.distance) * 100)}%, d={best.distance.toFixed(2)})</p>}
                      <select aria-label={`Assign face ${i + 1} to a student`} value={f.assignedId ?? ""} onChange={(e) => assignFace(i, e.target.value)}>
                        <option value="">Not assigned</option>
                        {roster.map((s) => {
                          const other = assigned.get(s.id);
                          return <option key={s.id} value={s.id} disabled={other !== undefined && other !== i}>{s.name}{other !== undefined && other !== i ? ` (face ${other + 1})` : ""}</option>;
                        })}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="panel-head">
            <h3>Review attendance: {subject.name}, Section {section}, {date}</h3>
            <button className="btn btn-outline" onClick={confirmMatched} disabled={![...assigned.keys()].some((id) => !existing.has(id))}><CheckCheck size={16} /> Confirm all matched as Present</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Student ID</th><th>Name</th><th>Face match status</th><th>Match score</th><th>Proposed attendance</th><th>Teacher review</th></tr></thead>
              <tbody>
                {roster.map((s) => {
                  const fi = assigned.get(s.id);
                  const cand = fi === undefined ? faces.find((f) => f.assignedId === null && f.status === "review" && f.candidates[0]?.studentId === s.id && f.candidates[0].distance <= threshold + DEFAULT_SETTINGS.weakMargin) : undefined;
                  const key = fi !== undefined ? "matched" : cand ? "review" : "none";
                  const d = fi !== undefined ? distTo(faces[fi], s.id) : cand ? cand.candidates[0].distance : null;
                  const dec = decisions[s.id];
                  const already = existing.has(s.id);
                  return (
                    <tr key={s.id}>
                      <td className="mono">{s.id}</td>
                      <td>{s.name}</td>
                      <td><span className={`badge ${STATUS_CLASS[key]}`}>{STATUS_LABEL[key]}</span>{!enrollments.has(s.id) && <span className="small muted"> not enrolled</span>}</td>
                      <td>{d === null ? "—" : `${Math.round(matchScore(d) * 100)}% (d=${d.toFixed(2)})`}</td>
                      <td>{already ? "Already recorded" : fi !== undefined ? "Present (pending confirmation)" : "Unconfirmed"}</td>
                      <td>
                        <div className="seg">
                          <button className={`seg-btn ${dec === "present" ? "on-blue" : ""}`} disabled={already} onClick={() => setDecision(s.id, dec === "present" ? undefined : "present")}>Present</button>
                          <button className={`seg-btn ${dec === "absent" ? "on-red" : ""}`} disabled={already} onClick={() => setDecision(s.id, dec === "absent" ? undefined : "absent")}>Absent</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">Students you do not mark stay unrecorded. “Absent” is saved only when you confirm it, following your college's attendance procedure.</p>
          <button className="btn btn-primary btn-lg" onClick={save} disabled={toSave.length === 0}><Save size={18} /> Save {toSave.length} confirmed record(s)</button>
        </>
      )}

      <details className="about">
        <summary>About the recognition model and its limits</summary>
        <p>Model: {MODEL_NAME}. It runs fully in the browser with TensorFlow.js (WebGL, falling back to CPU), loading local files from <span className="mono">/models</span>. No cloud API is used.</p>
        <ul>
          <li>Accuracy drops with small or distant faces, side angles, strong shadows, masks, hands over faces and motion blur. Such faces are sent to “Needs Review”, never auto-matched.</li>
          <li>Large photos are scanned in overlapping regions to help with small faces, which makes processing slower on weak devices.</li>
          <li>Similar-looking people can be confused. Close or ambiguous matches are flagged instead of guessed. Match score is (1 − distance) for display, not a probability.</li>
          <li>Recognition quality can differ across people and lighting. Treat it as a time-saving suggestion that a teacher confirms, not as proof of presence.</li>
          <li>Blur and size checks are tunable heuristics (see src/lib/recognition.ts).</li>
        </ul>
      </details>
    </section>
  );
}
