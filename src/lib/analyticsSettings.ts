import type { AnalyticsSettings } from "../types";
import { todayLocal } from "./utils";

const KEY = "smartattend.analytics.settings.v1";
export const SETTINGS_EVENT = "smartattend:settings";

const daysFrom = (now: Date, n: number) => todayLocal(new Date(now.getTime() + n * 86400000));

/** Demo defaults. The attendance threshold is deliberately NOT set: only an administrator configures it. */
export function seedSettings(now = new Date()): AnalyticsSettings {
  return { thresholdPct: null, semesterStart: daysFrom(now, -60), semesterEnd: daysFrom(now, 100), enrolledOn: { STU004: daysFrom(now, -14) } };
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function loadSettings(): AnalyticsSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) { const s = seedSettings(); saveSettings(s, false); return s; }
    const p = JSON.parse(raw) as Partial<AnalyticsSettings>;
    const t = p.thresholdPct;
    const enrolledOn: Record<string, string> = {};
    if (p.enrolledOn && typeof p.enrolledOn === "object") for (const [k, v] of Object.entries(p.enrolledOn)) if (isDate(v)) enrolledOn[k] = v;
    return {
      thresholdPct: typeof t === "number" && t >= 0 && t <= 100 ? t : null,
      semesterStart: isDate(p.semesterStart) ? p.semesterStart : null,
      semesterEnd: isDate(p.semesterEnd) ? p.semesterEnd : null,
      enrolledOn,
    };
  } catch {
    return { thresholdPct: null, semesterStart: null, semesterEnd: null, enrolledOn: {} };
  }
}

export function saveSettings(s: AnalyticsSettings, notify = true): string | null {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    if (notify) window.dispatchEvent(new Event(SETTINGS_EVENT));
    return null;
  } catch {
    return "Settings could not be saved to this browser (storage full or blocked).";
  }
}
