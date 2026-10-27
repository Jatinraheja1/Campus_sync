import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, GraduationCap, LogOut, ShieldCheck, UserCog, UserRound, WifiOff } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useAttendance } from "../context/AttendanceContext";
import { useConnectivity } from "../context/ConnectivityContext";
import { hasBackend } from "../lib/api";
import { ROLE_LABEL, dashboardPath } from "../lib/users";
import { ConnectionBadge, DemoToggle } from "./ConnectionControls";

const ROLE_ICON = { student: UserRound, teacher: UserCog, admin: ShieldCheck } as const;

export function Brand({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="brand">
      <span className="brand-mark"><GraduationCap size={22} /></span>
      <span>
        <strong>SmartAttend</strong>
        <small>Offline-first attendance</small>
      </span>
    </Link>
  );
}

export function OfflineBanner() {
  const { online } = useConnectivity();
  if (online) return null;
  return (
    <div className="banner" role="alert">
      <WifiOff size={20} />
      <span><strong>No internet connection.</strong> Attendance can still be marked. Records are saved on this device and wait to sync.</span>
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { storageError } = useAttendance();
  if (!user) return null;
  const Icon = ROLE_ICON[user.role];

  return (
    <div className="app">
      <header className="topbar">
        <Brand to={dashboardPath(user.role)} />
        <div className="topbar-right">
          <ConnectionBadge />
          <DemoToggle />
          <span className={`role-pill role-${user.role}`} title="Signed-in role"><Icon size={15} /> {ROLE_LABEL[user.role]}: {user.name}</span>
          <button className="btn btn-outline" onClick={logout}><LogOut size={16} /> Log out</button>
        </div>
      </header>
      <OfflineBanner />
      {storageError && (
        <div className="banner banner-error" role="alert"><AlertTriangle size={20} /> <span>{storageError}</span></div>
      )}
      <main>{children}</main>
      <footer>{hasBackend ? "Authenticated API mode: sign-in and roster management use the configured backend. Some attendance views still use local demo data." : "Offline demo mode: sign-in and sync are simulated in the frontend. Attendance is stored in this browser."}</footer>
    </div>
  );
}
