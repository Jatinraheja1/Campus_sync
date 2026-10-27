import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Edit2, KeyRound, Plus, RefreshCw, Search, ShieldCheck, UserRoundX, X } from "lucide-react";
import { BACKEND_URL } from "../lib/api";
import { TOKEN_KEY } from "../lib/authToken";
import { useAuth } from "../context/AuthContext";

type Role = "student" | "teacher" | "admin";
type StatusFilter = "all" | "active" | "disabled";
type UserRow = { id: string; name: string; email: string; role: Role; active: boolean; mustChangePassword?: boolean; createdAt?: string };
type UserForm = { id: string; name: string; email: string; role: Role; password: string; section: string; classGroup: string };
const emptyForm: UserForm = { id: "", name: "", email: "", role: "student", password: "", section: "A", classGroup: "" };
const PAGE_SIZE = 10;
async function apiRequest(path: string, init: RequestInit = {}) {
  if (!BACKEND_URL) throw new Error("Backend is not enabled. Set VITE_API_URL=http://localhost:4000 in the project-root .env file and restart Vite.");
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${BACKEND_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}
const roleLabel: Record<Role, string> = { student: "Student", teacher: "Teacher", admin: "Admin" };
export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(0);
  const [form, setForm] = useState<UserForm>(emptyForm); const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState(""); const [roleFilter, setRoleFilter] = useState<"all" | Role>("all"); const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null); const [temporaryPassword, setTemporaryPassword] = useState("");
  const loadUsers = useCallback(async (targetPage = page) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(targetPage * PAGE_SIZE) });
      if (search.trim()) params.set("search", search.trim()); if (roleFilter !== "all") params.set("role", roleFilter); if (statusFilter !== "all") params.set("status", statusFilter);
      const result = await apiRequest(`/admin/users?${params.toString()}`); setUsers(Array.isArray(result.users) ? result.users : []); setTotal(Number(result.total) || 0); setPage(targetPage);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load users."); } finally { setLoading(false); }
  }, [page, search, roleFilter, statusFilter]);
  useEffect(() => { const timer = window.setTimeout(() => { void loadUsers(0); }, 220); return () => window.clearTimeout(timer); }, [search, roleFilter, statusFilter]);
  const resetForm = () => { setEditingId(null); setForm(emptyForm); };
  const startEdit = (user: UserRow) => { setEditingId(user.id); setForm({ ...emptyForm, id: user.id, name: user.name, email: user.email, role: user.role }); setError(""); setMessage(""); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      if (editingId) { await apiRequest(`/admin/users/${encodeURIComponent(editingId)}`, { method: "PATCH", body: JSON.stringify({ name: form.name.trim(), email: form.email.trim() }) }); setMessage(`${form.name.trim()} updated successfully.`); }
      else { const payload: Record<string, string> = { id: form.id.trim(), name: form.name.trim(), email: form.email.trim(), role: form.role, password: form.password }; if (form.role === "student") { payload.section = form.section.trim(); payload.classGroup = form.classGroup.trim(); } await apiRequest("/admin/users", { method: "POST", body: JSON.stringify(payload) }); setMessage(`${roleLabel[form.role]} account ${form.id.trim()} created. The user can sign in with the password you set.`); }
      resetForm(); await loadUsers(0);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save user."); } finally { setSaving(false); }
  };
  const toggleActive = async (user: UserRow) => {
    const nextActive = !user.active; if (!window.confirm(`${nextActive ? "Reactivate" : "Disable login for"} ${user.name} (${user.id})? Existing attendance and related records will be preserved.`)) return;
    setError(""); setMessage(""); try { await apiRequest(`/admin/users/${encodeURIComponent(user.id)}`, { method: "PATCH", body: JSON.stringify({ active: nextActive }) }); setMessage(`${user.name}'s account was ${nextActive ? "reactivated" : "disabled"}.`); await loadUsers(page); } catch (e) { setError(e instanceof Error ? e.message : "Could not update account."); }
  };
  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!resetTarget) return; setError(""); setMessage(""); setSaving(true);
    try { await apiRequest(`/admin/users/${encodeURIComponent(resetTarget.id)}/reset-password`, { method: "POST", body: JSON.stringify({ temporaryPassword }) }); setMessage(`Password reset for ${resetTarget.name}. Share it privately.`); setResetTarget(null); setTemporaryPassword(""); await loadUsers(page); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not reset password."); } finally { setSaving(false); }
  };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <section className="card panel student-management admin-feature-panel">
    <div className="panel-head student-panel-head"><div><p className="eyebrow">DIRECTORY & ACCESS</p><h2>User Management</h2><p className="hint">Create, edit, disable and securely reset student, teacher and administrator accounts.</p></div><button className="btn btn-outline" type="button" onClick={() => void loadUsers(page)} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""}/> Refresh</button></div>
    {message && <div className="notice notice-success" role="status"><Check size={17}/>{message}</div>}{error && <div className="notice notice-error" role="alert"><X size={17}/>{error}</div>}
    <form className="student-form" onSubmit={submit}><h3>{editingId ? `Edit account · ${editingId}` : "Add a new user"}</h3><div className="student-form-grid">
      <label>User role<select value={form.role} disabled={Boolean(editingId)||saving} onChange={e=>setForm({...form,role:e.target.value as Role})}><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select></label>
      <label>User ID / admission number<input required minLength={2} maxLength={80} pattern="[A-Za-z0-9_-]+" title="Use letters, numbers, hyphens, or underscores" value={form.id} disabled={Boolean(editingId)||saving} onChange={e=>setForm({...form,id:e.target.value.toUpperCase()})} placeholder={form.role==="student"?"e.g. STU005":form.role==="teacher"?"e.g. TCH005":"e.g. ADM002"}/></label>
      <label>Full name<input required minLength={2} maxLength={160} value={form.name} disabled={saving} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Full name"/></label>
      <label>Email address<input required type="email" maxLength={200} value={form.email} disabled={saving} onChange={e=>setForm({...form,email:e.target.value})} placeholder="name@college.edu"/></label>
      {!editingId && <label className="student-field-wide">Initial password (minimum 12 characters)<input required type="password" minLength={12} maxLength={200} autoComplete="new-password" value={form.password} disabled={saving} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Create a strong initial password"/><small className="field-help">The password is hashed by the server. Share it privately with the user.</small></label>}
      {!editingId && form.role==="student" && <><label>Section<input required maxLength={20} value={form.section} disabled={saving} onChange={e=>setForm({...form,section:e.target.value.toUpperCase()})} placeholder="A"/></label><label>Class / group<input required maxLength={200} value={form.classGroup} disabled={saving} onChange={e=>setForm({...form,classGroup:e.target.value})} placeholder="e.g. B.Tech CSE, Year 2"/></label></>}
    </div><div className="student-form-actions"><button className="btn btn-primary" type="submit" disabled={saving}>{editingId?<Check size={16}/>:<Plus size={16}/>}{saving?"Saving…":editingId?"Save changes":"Create account"}</button>{editingId&&<button className="btn btn-outline" type="button" onClick={resetForm} disabled={saving}>Cancel edit</button>}</div></form>
    {resetTarget && <form className="reset-password-panel" onSubmit={resetPassword}><div><strong><KeyRound size={17}/> Reset password · {resetTarget.name}</strong><p className="hint">Set a new password. It will be hashed by the server and will work at the next sign-in.</p></div><label>New password<input type="password" minLength={12} maxLength={200} autoComplete="new-password" required value={temporaryPassword} onChange={e=>setTemporaryPassword(e.target.value)} placeholder="At least 12 characters"/></label><div className="student-form-actions"><button className="btn btn-primary" type="submit" disabled={saving}>{saving?"Resetting…":"Reset password"}</button><button className="btn btn-outline" type="button" onClick={()=>{setResetTarget(null);setTemporaryPassword("")}}>Cancel</button></div></form>}
    <div className="student-list-toolbar"><div className="search student-search"><Search size={16}/><input aria-label="Search users" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, ID, email…"/></div><label>Role<select value={roleFilter} onChange={e=>setRoleFilter(e.target.value as "all"|Role)}><option value="all">All roles</option><option value="student">Students</option><option value="teacher">Teachers</option><option value="admin">Admins</option></select></label><label>Status<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value as StatusFilter)}><option value="all">All accounts</option><option value="active">Active</option><option value="disabled">Disabled</option></select></label></div>
    {loading?<div className="empty"><RefreshCw className="spin" size={22}/>Loading users…</div>:users.length===0?<div className="empty"><UserRoundX size={24}/><strong>No users found</strong><span>Change filters or create a new account above.</span></div>:<div className="table-wrap"><table className="student-table"><thead><tr><th>User ID</th><th>Name / email</th><th>Role</th><th>Account</th><th>Security</th><th>Actions</th></tr></thead><tbody>{users.map(user=><tr key={user.id}><td className="mono">{user.id}</td><td><strong>{user.name}</strong><div className="muted student-email">{user.email}</div></td><td><span className="badge">{user.role==="admin"&&<ShieldCheck size={12}/>} {roleLabel[user.role]}</span></td><td>{user.active?<span className="badge badge-green">Active</span>:<span className="badge badge-red">Disabled</span>}</td><td>{user.mustChangePassword?<span className="badge badge-amber">Change required</span>:<span className="muted">Up to date</span>}</td><td><div className="student-row-actions"><button className="btn btn-outline btn-sm" type="button" onClick={()=>startEdit(user)} disabled={saving}><Edit2 size={14}/> Edit</button><button className="btn btn-outline btn-sm" type="button" onClick={()=>{setResetTarget(user);setTemporaryPassword("");setError("")}} disabled={saving||!user.active||user.id===currentUser?.id}><KeyRound size={14}/> Reset</button><button className={`btn ${user.active?"btn-warn":"btn-outline"} btn-sm`} type="button" onClick={()=>void toggleActive(user)} disabled={saving}>{user.active?<UserRoundX size={14}/>:<Check size={14}/>}{user.active?"Disable":"Reactivate"}</button></div></td></tr>)}</tbody></table></div>}
    <div className="pagination"><span className="muted">{total===0?"No results":`Showing ${page*PAGE_SIZE+1}–${Math.min((page+1)*PAGE_SIZE,total)} of ${total} accounts`}</span><div className="pagination-actions"><button className="btn btn-outline btn-sm" disabled={page===0||loading} onClick={()=>void loadUsers(page-1)} type="button"><ChevronLeft size={15}/> Previous</button><span className="page-count">Page {Math.min(page+1,pages)} of {pages}</span><button className="btn btn-outline btn-sm" disabled={page+1>=pages||loading} onClick={()=>void loadUsers(page+1)} type="button">Next <ChevronRight size={15}/></button></div></div>
    <p className="hint">Accounts are deactivated rather than permanently deleted, preserving attendance history. Initial passwords should be shared privately, never in a public chat.</p>
  </section>;
}
