import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useBrowserOnline } from "../hooks/useBrowserOnline";

interface ConnectivityValue {
  browserOnline: boolean; // real detection
  demoOffline: boolean; // separate demo switch
  online: boolean; // effective status used by the app
  toggleDemoOffline: () => void;
}

const Ctx = createContext<ConnectivityValue | null>(null);

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const browserOnline = useBrowserOnline();
  const [demoOffline, setDemoOffline] = useState(false);
  const value = useMemo<ConnectivityValue>(
    () => ({
      browserOnline,
      demoOffline,
      online: browserOnline && !demoOffline,
      toggleDemoOffline: () => setDemoOffline((v) => !v),
    }),
    [browserOnline, demoOffline]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnectivity(): ConnectivityValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useConnectivity must be used inside ConnectivityProvider");
  return v;
}
