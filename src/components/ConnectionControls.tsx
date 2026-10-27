import { FlaskConical, Wifi, WifiOff } from "lucide-react";
import { useConnectivity } from "../context/ConnectivityContext";

export function ConnectionBadge({ large = false }: { large?: boolean }) {
  const { online, browserOnline, demoOffline } = useConnectivity();
  const note = !browserOnline ? "browser has no network" : demoOffline ? "demo mode" : "browser connected";
  return (
    <span className={`conn ${online ? "conn-on" : "conn-off"} ${large ? "conn-lg" : ""}`} role="status">
      {online ? <Wifi size={large ? 22 : 16} /> : <WifiOff size={large ? 22 : 16} />}
      <strong>{online ? "Online" : "Offline"}</strong>
      <small>{note}</small>
    </span>
  );
}

/** Demo switch. Separate from real browser detection. */
export function DemoToggle() {
  const { demoOffline, toggleDemoOffline } = useConnectivity();
  return (
    <button
      className={`btn ${demoOffline ? "btn-warn" : "btn-outline"}`}
      onClick={toggleDemoOffline}
      aria-pressed={demoOffline}
      title="Demo control. Real browser connectivity is still detected separately."
    >
      <FlaskConical size={16} />
      {demoOffline ? "Demo: offline (click to go online)" : "Demo: simulate offline"}
    </button>
  );
}
