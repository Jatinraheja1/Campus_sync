import { Loader2, RefreshCw } from "lucide-react";
import { useAttendance } from "../context/AttendanceContext";
import { useConnectivity } from "../context/ConnectivityContext";
import NoticeBox from "./NoticeBox";
import { BACKEND_URL, hasBackend } from "../lib/api";

export default function SyncPanel() {
  const { counts, syncing, forceError, setForceError, syncNotice, syncPending } = useAttendance();
  const { online } = useConnectivity();
  const pct = counts.total === 0 ? 0 : Math.round((counts.synced / counts.total) * 100);

  return (
    <section className="card panel" aria-labelledby="sync-title">
      <h2 id="sync-title"><RefreshCw size={18} /> Synchronization</h2>
      <p className={hasBackend ? "badge-live" : "badge-sim"}>{hasBackend ? `Live backend: ${BACKEND_URL}` : "Frontend simulation: no server upload happens"}</p>

      <div className="sync-counts">
        <div><span className="num orange">{counts.pending}</span><span>Pending</span></div>
        <div><span className="num green">{counts.synced}</span><span>Synced</span></div>
        {counts.failed > 0 && <div><span className="num red">{counts.failed}</span><span>Failed</span></div>}
      </div>

      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Synchronization progress">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="progress-label">{pct}% synchronized ({counts.synced} of {counts.total})</p>

      <button className="btn btn-primary" onClick={() => void syncPending()} disabled={!online || syncing || counts.pending === 0}>
        {syncing ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
        {syncing ? "Syncing…" : "Sync pending items"}
      </button>

      <p className="hint">
        {!online
          ? "You are offline. Pending items are saved locally on this device and can be synced once the connection returns."
          : counts.pending === 0
          ? "Nothing to sync right now."
          : `${counts.pending} item(s) (attendance records and finalized class sessions) saved locally are ready to sync.`}
      </p>

      {!hasBackend && (
        <label className="check">
          <input type="checkbox" checked={forceError} onChange={(e) => setForceError(e.target.checked)} />
          Demo: make the next sync fail (shows Sync Failed)
        </label>
      )}

      <NoticeBox notice={syncNotice} />
    </section>
  );
}
