import type { AttendanceRecord, ClassSession } from "../types";
import { sleep } from "./utils";
import { TOKEN_KEY } from "./authToken";

/**
 * Backend integration point.
 * Set VITE_API_URL (see .env.example) to enable REAL synchronization:
 *   POST {VITE_API_URL}/attendance   body: the AttendanceRecord JSON
 *   header "Idempotency-Key": record.id   (so retries never create duplicates)
 *   200/201 = stored, 409 = already stored (both count as success). Anything else = failure.
 * Without VITE_API_URL the app uses a clearly labelled simulation and never claims a real upload.
 */
const raw = import.meta.env.VITE_API_URL as string | undefined;
export const BACKEND_URL: string | null = raw && raw.trim() ? raw.trim().replace(/\/$/, "") : null;
export const hasBackend = BACKEND_URL !== null;

export async function uploadRecord(record: AttendanceRecord, opts: { simulateFailure: boolean }): Promise<{ ok: boolean; error?: string }> {
  if (!BACKEND_URL) {
    await sleep(700);
    return opts.simulateFailure ? { ok: false, error: "Simulated server error" } : { ok: true };
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const res = await fetch(`${BACKEND_URL}/attendance`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": record.id, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(record),
    });
    if (res.ok || res.status === 409) return { ok: true };
    return { ok: false, error: `Server responded ${res.status}` };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

/**
 * Class sessions are uploaded after their attendance records.
 *   POST {VITE_API_URL}/sessions   body: the ClassSession JSON   header "Idempotency-Key": session.id
 * The session id is deterministic (SES-{section}-{subject}-{date}), so retries and other devices cannot create a second session.
 */
export async function uploadSession(session: ClassSession, opts: { simulateFailure: boolean }): Promise<{ ok: boolean; error?: string }> {
  if (!BACKEND_URL) {
    await sleep(400);
    return opts.simulateFailure ? { ok: false, error: "Simulated server error" } : { ok: true };
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const res = await fetch(`${BACKEND_URL}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": session.id, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(session),
    });
    if (res.ok || res.status === 409) return { ok: true };
    return { ok: false, error: `Server responded ${res.status}` };
  } catch {
    return { ok: false, error: "Network error" };
  }
}
