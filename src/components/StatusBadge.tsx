import { CheckCircle2, Clock, UserCheck, UserX, XCircle } from "lucide-react";
import type { AttendanceValue, SyncStatus } from "../types";

export default function StatusBadge({ status }: { status: SyncStatus }) {
  if (status === "Synced") return <span className="badge badge-green"><CheckCircle2 size={14} /> Synced</span>;
  if (status === "Sync Failed") return <span className="badge badge-red"><XCircle size={14} /> Sync Failed</span>;
  return <span className="badge badge-orange"><Clock size={14} /> Pending Sync</span>;
}

export function AttendanceBadge({ value }: { value: AttendanceValue }) {
  return value === "Present"
    ? <span className="badge badge-blue"><UserCheck size={14} /> Present</span>
    : <span className="badge badge-red"><UserX size={14} /> Absent (confirmed)</span>;
}
