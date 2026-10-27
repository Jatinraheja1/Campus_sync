import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABEL, dashboardPath } from "../lib/users";
import type { Role } from "../types";

/** Frontend-only route guard (demo). Real authorization must be enforced by the backend. */
export default function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, logout, mustChangePassword } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to={`/login/${role}`} replace state={{ from: location.pathname }} />;

  if (mustChangePassword) return <Navigate to="/change-password" replace />;

  if (user.role !== role) {
    return (
      <div className="center-screen">
        <div className="card panel denied">
          <ShieldAlert size={36} />
          <h2>Access denied</h2>
          <p>You are signed in as <strong>{ROLE_LABEL[user.role]}</strong>. The {ROLE_LABEL[role]} area is not available to your role.</p>
          <Link className="btn btn-primary" to={dashboardPath(user.role)}>Go to my dashboard</Link>
          <button className="btn btn-outline" onClick={logout}>Log out</button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
