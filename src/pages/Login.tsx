import { useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, LogIn, ShieldCheck, UserCog, UserRound } from "lucide-react";
import { Brand, OfflineBanner } from "../components/AppShell";
import { ConnectionBadge } from "../components/ConnectionControls";
import { useAuth } from "../context/AuthContext";
import { DEMO_CREDENTIALS, ROLE_LABEL, dashboardPath, isRole } from "../lib/users";
import { hasBackend } from "../lib/api";

const ICONS = { student: UserRound, teacher: UserCog, admin: ShieldCheck } as const;
const IDENT_LABEL = { student: "Student ID or registered email", teacher: "Teacher ID or registered email", admin: "Administrator email" } as const;
const IDENT_HINT = { student: "e.g. STU001 or student@demo.com", teacher: "e.g. TCH001 or teacher@demo.com", admin: "admin@demo.com" } as const;

export default function Login() {
  const { role: roleParam } = useParams();
  const { user, login, mustChangePassword } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ identifier?: string; password?: string; form?: string }>({});

  if (!isRole(roleParam)) return <Navigate to="/" replace />;
  if (user) return <Navigate to={mustChangePassword ? "/change-password" : dashboardPath(user.role)} replace />;

  const role = roleParam;
  const Icon = ICONS[role];
  const demo = DEMO_CREDENTIALS[role];

  const attempt = async (id: string, pw: string) => {
    const next: typeof errors = {};
    if (!id.trim()) next.identifier = role === "admin" ? "Enter your administrator email." : `Enter your ${ROLE_LABEL[role]} ID or registered email.`;
    if (!pw) next.password = "Enter your password.";
    if (Object.keys(next).length) { setErrors(next); return; }
    const res = await login(role, id, pw);
    if (!res.ok) setErrors({ form: res.error });
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void attempt(identifier, password); };

  return (
    <div className="app narrow">
      <header className="topbar"><Brand /><ConnectionBadge /></header>
      <OfflineBanner />

      <section className={`card panel auth role-${role}`}>
        <Link to="/" className="back"><ArrowLeft size={16} /> Back to role selection</Link>
        <div className="auth-head">
          <span className="role-icon"><Icon size={26} /></span>
          <div><h2>{ROLE_LABEL[role]} login</h2><p className="hint">Sign in to open the {ROLE_LABEL[role].toLowerCase()} dashboard.</p></div>
        </div>

        <form onSubmit={onSubmit} noValidate className="form">
          <label htmlFor="ident">{IDENT_LABEL[role]}</label>
          <input id="ident" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={IDENT_HINT[role]} autoComplete="username" aria-invalid={!!errors.identifier} />
          {errors.identifier && <p className="field-error">{errors.identifier}</p>}

          <label htmlFor="pw">Password</label>
          <div className="pw-wrap">
            <input id="pw" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-invalid={!!errors.password} />
            <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.password && <p className="field-error">{errors.password}</p>}
          {errors.form && <div className="notice notice-error" role="alert">{errors.form}</div>}

          <button className="btn btn-primary btn-lg" type="submit"><LogIn size={18} /> Log in</button>
        </form>

        {!hasBackend && <div className="demo-box">
          <p><strong>Demo credentials (offline demonstration only)</strong></p>
          <p className="mono">{demo.email} / {demo.password}</p>
          <button className="btn btn-outline" type="button" onClick={() => attempt(demo.email, demo.password)}>Use demo {ROLE_LABEL[role].toLowerCase()} login</button>
          <p className="hint">Offline demo mode uses browser-side sample authentication. Configure the API to use server-side sign-in.</p>
        </div>}
      </section>
    </div>
  );
}
