import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Brand } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { dashboardPath } from "../lib/users";

export default function ChangePassword() {
  const { user, mustChangePassword, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (!user) return <Navigate to="/" replace />;
  if (!mustChangePassword) return <Navigate to={dashboardPath(user.role)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError("");
    if (newPassword.length < 12) { setError("Use at least 12 characters for your new password."); return; }
    if (newPassword !== confirmPassword) { setError("The new passwords do not match."); return; }
    setSaving(true);
    const result = await changePassword(currentPassword, newPassword);
    setSaving(false);
    if (!result.ok) { setError(result.error || "Could not change password."); return; }
    navigate(dashboardPath(user.role), { replace: true });
  };

  return <div className="app narrow password-page"><header className="topbar"><Brand /></header><section className="card panel auth password-card">
    <div className="auth-head"><span className="role-icon"><KeyRound size={25} /></span><div><h2>{mustChangePassword ? "Set your new password" : "Change password"}</h2><p className="hint">For account security, set a private password before continuing.</p></div></div>
    {mustChangePassword && <div className="notice notice-info"><ShieldCheck size={17} />Your account has a temporary password. You must replace it before using the dashboard.</div>}
    <form className="form" onSubmit={submit}>
      <label htmlFor="currentPassword">Current / temporary password</label><input id="currentPassword" type="password" autoComplete="current-password" required value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} />
      <label htmlFor="newPassword">New password</label><input id="newPassword" type="password" autoComplete="new-password" minLength={12} required value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="At least 12 characters" />
      <label htmlFor="confirmPassword">Confirm new password</label><input id="confirmPassword" type="password" autoComplete="new-password" minLength={12} required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} />
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <button className="btn btn-primary btn-lg" type="submit" disabled={saving}>{saving ? "Updating password…" : "Save new password"}</button>
      <button className="btn btn-outline btn-lg" type="button" onClick={logout}>Sign out</button>
    </form>
  </section></div>;
}
