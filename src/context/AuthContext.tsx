import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Account, Role } from "../types";
import { ACCOUNTS } from "../lib/users";
import { hashPassword } from "../lib/sha256";
import { BACKEND_URL } from "../lib/api";
import { TOKEN_KEY } from "../lib/authToken";

// When VITE_API_URL is set, credentials are checked by the API and a short-lived bearer token is used.
// Without a backend URL, the original offline demo login is retained.
const SESSION_KEY = "smartattend.session.v1";
const FORCE_PASSWORD_KEY = "smartattend.force-password-change";

interface AuthValue {
  user: Account | null;
  login: (role: Role, identifier: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  mustChangePassword: boolean;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>;
}

const Ctx = createContext<AuthValue | null>(null);

function readSession(): Account | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { userId?: string; id?: string; role?: Role; name?: string; email?: string };
    // New sessions store the server-returned identity so newly-created students survive refresh.
    if (saved.id && saved.role && saved.name && saved.email && ["student", "teacher", "admin"].includes(saved.role)) {
      return { id: saved.id, role: saved.role, name: saved.name, email: saved.email, passwordHash: "" };
    }
    // Backward compatibility for sessions created by the older demo build.
    return ACCOUNTS.find((a) => a.id === saved.userId) ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Account | null>(readSession);
  const [mustChangePassword, setMustChangePassword] = useState<boolean>(false);

  const login = useCallback<AuthValue["login"]>(async (role, identifier, password) => {
    let account: Account | undefined;
    if (BACKEND_URL) {
      try {
        const response = await fetch(`${BACKEND_URL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, identifier: identifier.trim(), password }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) return { ok: false, error: payload.error || "Sign-in failed. Check your details and try again." };
        const serverUser = payload.user;
        if (!payload.token || !serverUser?.id || serverUser.role !== role) return { ok: false, error: "The server returned an invalid sign-in response." };
        account = {
          id: serverUser.id, role: serverUser.role, name: serverUser.name,
          email: serverUser.email, passwordHash: "",
        };
        setMustChangePassword(Boolean(serverUser.mustChangePassword));
        localStorage.setItem(FORCE_PASSWORD_KEY, serverUser.mustChangePassword ? "true" : "false");
        localStorage.setItem(TOKEN_KEY, payload.token);
      } catch {
        return { ok: false, error: "Cannot reach the backend. Check that the API server is running." };
      }
    } else {
      setMustChangePassword(false);
      localStorage.setItem(FORCE_PASSWORD_KEY, "false");
      const ident = identifier.trim().toLowerCase();
      account = ACCOUNTS.find(
        (a) => a.role === role && (a.email.toLowerCase() === ident || (role !== "admin" && a.id.toLowerCase() === ident))
      );
      if (!account || account.passwordHash !== hashPassword(password)) {
        return { ok: false, error: "Incorrect ID/email or password for this role. Check the details and try again." };
      }
    }
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ id: account.id, role: account.role, name: account.name, email: account.email }));
    } catch { /* session still works in memory */ }
    setUser(account);
    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(FORCE_PASSWORD_KEY);
    } catch {
      /* ignore */
    }
    setMustChangePassword(false);
    setUser(null);
  }, []);

  const changePassword = useCallback<AuthValue["changePassword"]>(async (currentPassword, newPassword) => {
    if (!BACKEND_URL) return { ok: false, error: "Password changes require the connected backend." };
    const token = localStorage.getItem(TOKEN_KEY);
    try {
      const response = await fetch(`${BACKEND_URL}/auth/change-password`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ currentPassword, newPassword }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, error: payload.error || "Could not update password." };
      setMustChangePassword(false);
      localStorage.setItem(FORCE_PASSWORD_KEY, "false");
      return { ok: true };
    } catch { return { ok: false, error: "Cannot reach the backend. Check that the API server is running." }; }
  }, []);

  const value = useMemo(() => ({ user, login, logout, mustChangePassword, changePassword }), [user, login, logout, mustChangePassword, changePassword]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
