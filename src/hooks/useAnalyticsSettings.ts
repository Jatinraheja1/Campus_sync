import { useCallback, useEffect, useState } from "react";
import type { AnalyticsSettings } from "../types";
import { SETTINGS_EVENT, loadSettings, saveSettings } from "../lib/analyticsSettings";

/** Shared analytics settings (threshold, semester, enrollment dates). Stays in step across components and tabs. */
export function useAnalyticsSettings() {
  const [settings, setSettings] = useState<AnalyticsSettings>(loadSettings);
  useEffect(() => {
    const refresh = () => setSettings(loadSettings());
    window.addEventListener("storage", refresh);
    window.addEventListener(SETTINGS_EVENT, refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener(SETTINGS_EVENT, refresh); };
  }, []);
  const save = useCallback((next: AnalyticsSettings): string | null => {
    const err = saveSettings(next);
    setSettings(next);
    return err;
  }, []);
  return { settings, save };
}
