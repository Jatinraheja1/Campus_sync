import { useCallback, useEffect, useState } from "react";
import { Loader2, ScanFace, ShieldAlert, Trash2 } from "lucide-react";
import CameraCapture from "./CameraCapture";
import NoticeBox from "./NoticeBox";
import { useAuth } from "../context/AuthContext";
import { useEnrollments } from "../hooks/useEnrollments";
import { detectFaces, faceSharpness, MODEL_NAME } from "../lib/face";
import { MAX_SAMPLES, removeEnrollment, saveEnrollment } from "../lib/faceStore";
import { STUDENTS } from "../lib/users";
import { BACKEND_URL } from "../lib/api";
import { TOKEN_KEY } from "../lib/authToken";
import type { Notice, Student } from "../types";

export default function FaceEnrollmentPanel() {
  const { user } = useAuth();
  const { enrollments, loading, error, reload } = useEnrollments();
  const [students, setStudents] = useState<Student[]>(BACKEND_URL ? [] : STUDENTS);
  const [studentsLoading, setStudentsLoading] = useState(Boolean(BACKEND_URL));
  const [studentsError, setStudentsError] = useState("");
  const [studentId, setStudentId] = useState(BACKEND_URL ? "" : (STUDENTS[0]?.id ?? ""));
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const loadStudents = useCallback(async () => {
    if (!BACKEND_URL) {
      setStudents(STUDENTS);
      setStudentsError("");
      setStudentsLoading(false);
      return;
    }
    setStudentsLoading(true);
    setStudentsError("");
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${BACKEND_URL}/admin/students`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Could not load student roster (${response.status}).`);
      const nextStudents = Array.isArray(payload.students)
        ? payload.students.filter((item: Student & { active?: boolean }) => item && typeof item.id === "string" && item.active !== false)
            .map((item: Student) => ({ id: item.id, name: item.name, email: item.email, section: item.section || "—", classGroup: item.classGroup }))
        : [];
      setStudents(nextStudents);
      setStudentId((current) => nextStudents.some((item: Student) => item.id === current) ? current : (nextStudents[0]?.id ?? ""));
    } catch (e) {
      setStudentsError(e instanceof Error ? e.message : "Could not load students from the server.");
      setStudents([]);
      setStudentId("");
    } finally {
      setStudentsLoading(false);
    }
  }, []);

  useEffect(() => { void loadStudents(); }, [loadStudents]);

  const student = students.find((s) => s.id === studentId);
  const enrolledCount = students.filter((s) => enrollments.has(s.id)).length;
  const fail = (text: string) => setNotice({ kind: "error", text });

  const enroll = async () => {
    setNotice(null);
    if (!user) return;
    if (!student) return fail("Select a student from the loaded student roster first.");
    if (!consent) return fail("Consent is required. Confirm that the student has agreed and the college has authorized face enrollment.");
    if (!photo) return fail("Capture or upload a clear photo of the student first.");
    setBusy(true);
    try {
      const faces = await detectFaces(photo, { tile: false });
      if (faces.length === 0) return fail("No face was detected. Face the camera directly in good light and retake the photo.");
      if (faces.length > 1) return fail(`${faces.length} faces were detected. Enrollment needs a photo with only ${student.name} in it.`);
      const f = faces[0];
      if (Math.min(f.box.w, f.box.h) < 120) return fail("The face is too small. Move closer so the face fills more of the frame.");
      if (f.score < 0.8) return fail("The face is unclear or partly hidden. Remove obstructions and retake the photo.");
      if (faceSharpness(photo, f.box) < 20) return fail("The photo is blurry. Hold the camera steady and retake it.");

      const now = new Date().toISOString();
      const existing = enrollments.get(studentId);
      const descriptors = [...(existing?.descriptors ?? []), f.descriptor].slice(-MAX_SAMPLES);
      await saveEnrollment({
        studentId, descriptors,
        enrolledAt: existing?.enrolledAt ?? now, updatedAt: now,
        consentAt: now, consentRecordedBy: `${user.name} (${user.id})`, model: MODEL_NAME,
      });
      await reload();
      setPhoto(null); setConsent(false); setResetKey((k) => k + 1);
      setNotice({ kind: "success", text: `${student.name}: sample ${descriptors.length} of ${MAX_SAMPLES} saved. Only a face descriptor was stored; the photo was discarded.` });
    } catch (e) {
      fail(e instanceof Error ? e.message : "Enrollment failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete ${name}'s face enrollment? They will no longer be recognized until enrolled again.`)) return;
    try {
      await removeEnrollment(id);
      await reload();
      setNotice({ kind: "success", text: `${name}'s face enrollment was deleted.` });
    } catch {
      fail("The enrollment could not be deleted. Try again.");
    }
  };

  return (
    <section className="card panel" aria-labelledby="enroll-title">
      <h2 id="enroll-title"><ScanFace size={18} /> Face enrollment</h2>
      <div className="notice notice-info"><ShieldAlert size={18} /><span>
        Face data is biometric personal data. Enroll a student only with their informed consent and your college's authorization.
        Only a numeric face descriptor is stored on this device; photos are never saved. Browser storage is not a secure vault: production use needs server-side encrypted storage and access control.
      </span></div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {studentsError && <div className="notice notice-error" role="alert">Student roster: {studentsError} <button className="btn btn-outline btn-sm" type="button" onClick={() => void loadStudents()}>Retry</button></div>}
      <p className="hint">{studentsLoading || loading ? "Loading students and face samples…" : `${enrolledCount} of ${students.length} active students enrolled. Students who are not enrolled cannot be recognized and must be marked manually.`}</p>

      <div className="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Student</th><th>Section</th><th>Enrollment</th><th>Consent confirmed</th><th>Actions</th></tr></thead>
          <tbody>
            {students.map((s) => {
              const e = enrollments.get(s.id);
              return (
                <tr key={s.id}>
                  <td className="mono">{s.id}</td><td>{s.name}</td><td>{s.section}</td>
                  <td>{e ? <span className="badge badge-green">Enrolled ({e.descriptors.length}/{MAX_SAMPLES} samples)</span> : <span className="badge badge-orange">Not enrolled</span>}</td>
                  <td>{e ? new Date(e.consentAt).toLocaleDateString() : <span className="muted">—</span>}</td>
                  <td className="row-actions">
                    <button className="btn btn-outline" onClick={() => { setStudentId(s.id); setNotice(null); }}>{e ? "Add sample" : "Enroll"}</button>
                    {e && <button className="btn btn-ghost" onClick={() => void remove(s.id, s.name)}><Trash2 size={15} /> Delete</button>}
                  </td>
                </tr>
              );
            })}
            {!studentsLoading && students.length === 0 && <tr><td colSpan={6}>{studentsError ? "Student roster could not be loaded. Retry above." : "No active students found. Add a student in User Management first."}</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>Capture a face sample</h3>
      <label htmlFor="enroll-student">Student</label>
      <select id="enroll-student" value={studentId} disabled={studentsLoading || students.length === 0} onChange={(e) => { setStudentId(e.target.value); setNotice(null); }}>
        {students.length === 0 && <option value="">No students available</option>}
        {students.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
      </select>
      <label className="check">
        <input type="checkbox" checked={consent} disabled={!student} onChange={(e) => setConsent(e.target.checked)} />
        I confirm {student ? student.name : "the selected student"} has given informed consent and the college has authorized collecting this face data.
      </label>
      <CameraCapture key={resetKey} onChange={setPhoto} captureLabel="Capture face" facing="user" />
      <button className="btn btn-primary" onClick={() => void enroll()} disabled={busy || !photo || !student || studentsLoading}>
        {busy ? <Loader2 size={18} className="spin" /> : <ScanFace size={18} />} {busy ? "Analysing face…" : "Save face sample"}
      </button>
      <button className="btn btn-outline" type="button" onClick={() => void loadStudents()} disabled={studentsLoading}>{studentsLoading ? "Refreshing students…" : "Refresh student list"}</button>
      <p className="hint">Up to {MAX_SAMPLES} samples per student (different angles or lighting improve accuracy). Adding more replaces the oldest.</p>
      <NoticeBox notice={notice} />
    </section>
  );
}
