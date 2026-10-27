import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, History, RefreshCw, Search } from "lucide-react";
import type { AttendanceRecord } from "../types";
import { BACKEND_URL } from "../lib/api";
import { TOKEN_KEY } from "../lib/authToken";
import RecordsTable from "./RecordsTable";
const PAGE_SIZE = 10;
async function request(path: string) {
  if (!BACKEND_URL) throw new Error("Backend is not enabled.");
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${BACKEND_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}
export default function AdminAttendanceHistory({ localRecords }: { localRecords: AttendanceRecord[] }) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [backend, setBackend] = useState(Boolean(BACKEND_URL));
  const load = useCallback(async (nextPage = page, term = search) => {
    if (!BACKEND_URL) { setBackend(false); setRecords(localRecords.slice(nextPage * PAGE_SIZE, (nextPage + 1) * PAGE_SIZE)); setTotal(localRecords.length); setPage(nextPage); return; }
    setLoading(true); setError(""); setBackend(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextPage * PAGE_SIZE) });
      if (term.trim()) params.set("search", term.trim());
      const result = await request(`/admin/attendance?${params.toString()}`);
      setRecords(Array.isArray(result.records) ? result.records : []); setTotal(Number(result.total) || 0); setPage(nextPage);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load attendance history."); }
    finally { setLoading(false); }
  }, [page, search, localRecords]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(0, search); }, 180); return () => window.clearTimeout(timer); }, [search]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <section className="card panel">
    <div className="panel-head"><div><h2><History size={18}/> Attendance history</h2><p className="hint">{backend ? "Records loaded from the PostgreSQL database." : "Offline demo records from this browser."}</p></div><button type="button" className="btn btn-outline" onClick={() => void load(page)} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""}/> Refresh</button></div>
    {backend && <div className="search"><Search size={16}/><input aria-label="Search attendance history" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student, ID, subject or teacher…"/></div>}
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {loading ? <div className="empty"><RefreshCw className="spin" size={22}/>Loading attendance history…</div> : <RecordsTable records={records} showMarkedBy emptyTitle="No attendance history found" emptyText="Attendance records appear here after they have been synced to the server."/>}
    <div className="pagination"><span className="muted">{total === 0 ? "No results" : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total} records`}</span><div className="pagination-actions"><button className="btn btn-outline btn-sm" type="button" disabled={page === 0 || loading} onClick={() => void load(page - 1)}><ChevronLeft size={15}/> Previous</button><span className="page-count">Page {Math.min(page + 1, pages)} of {pages}</span><button className="btn btn-outline btn-sm" type="button" disabled={page + 1 >= pages || loading} onClick={() => void load(page + 1)}>Next <ChevronRight size={15}/></button></div></div>
    <p className="hint">Only synced server records appear in database mode. Locally queued records must be synced from the teacher dashboard first.</p>
  </section>;
}
