import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, UserCog, UserRound } from "lucide-react";
import { Brand } from "../components/AppShell";
import { ConnectionBadge, DemoToggle } from "../components/ConnectionControls";
import { OfflineBanner } from "../components/AppShell";
import Workflow from "../components/Workflow";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABEL, dashboardPath } from "../lib/users";
import type { Role } from "../types";

const ROLES: { role: Role; icon: typeof UserRound; text: string }[] = [
  { role: "student", icon: UserRound, text: "See your own attendance, today's status, and whether records are still waiting to sync." },
  { role: "teacher", icon: UserCog, text: "Mark students present for your classes, even offline, and sync saved records when internet returns." },
  { role: "admin", icon: ShieldCheck, text: "Monitor all attendance records, sync status, and the list of registered students and teachers." },
];

export default function Landing() {
  const { user, logout } = useAuth();
  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <div className="topbar-right"><DemoToggle /></div>
      </header>
      <OfflineBanner />

      <section className="hero card">
        <div>
          <h1>Attendance that works without internet</h1>
          <p>
            SmartAttend saves every attendance record on the device first. When the connection returns,
            saved records are synchronized, so no class is ever lost to a bad network.
          </p>
        </div>
        <ConnectionBadge large />
      </section>

      {user && (
        <div className="notice notice-info signed">
          <span>Signed in as <strong>{ROLE_LABEL[user.role]}</strong> ({user.name}).</span>
          <span className="signed-actions">
            <Link className="btn btn-primary" to={dashboardPath(user.role)}>Open dashboard</Link>
            <button className="btn btn-outline" onClick={logout}>Log out</button>
          </span>
        </div>
      )}

      <Workflow />

      <h2 className="section-title">Choose how you want to sign in</h2>
      <div className="roles">
        {ROLES.map(({ role, icon: Icon, text }) => (
          <article key={role} className={`card role-card role-${role}`}>
            <span className="role-icon"><Icon size={28} /></span>
            <h3>{ROLE_LABEL[role]}</h3>
            <p>{text}</p>
            <Link className="btn btn-primary" to={`/login/${role}`}>Log in as {ROLE_LABEL[role]} <ArrowRight size={16} /></Link>
          </article>
        ))}
      </div>
      <footer>College engineering project prototype. Demo sign-in only; not secure for real use.</footer>
    </div>
  );
}
