export function newRecordId(): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ATT-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

export function todayLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
