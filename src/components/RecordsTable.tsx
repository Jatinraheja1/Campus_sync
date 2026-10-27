import { Inbox } from "lucide-react";
import type { AttendanceRecord } from "../types";
import { formatDateTime } from "../lib/utils";
import StatusBadge, { AttendanceBadge } from "./StatusBadge";

interface Props {
  records: AttendanceRecord[];
  showStudent?: boolean;
  showMarkedBy?: boolean;
  emptyTitle?: string;
  emptyText?: string;
}

export default function RecordsTable({ records, showStudent = true, showMarkedBy = false, emptyTitle = "No attendance records yet", emptyText = "Records appear here as soon as attendance is confirmed." }: Props) {
  if (records.length === 0) {
    return (
      <div className="empty">
        <Inbox size={34} />
        <p><strong>{emptyTitle}</strong></p>
        <p>{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Attendance ID</th>
            {showStudent && <th>Student</th>}
            <th>Subject</th>
            <th>Date</th>
            <th>Attendance</th>
            {showMarkedBy && <th>Marked by</th>}
            <th>Sync status</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.id}</td>
              {showStudent && <td>{r.studentName} <span className="muted">({r.studentId})</span></td>}
              <td>{r.className} <span className="muted">({r.classId}, Sec {r.section})</span></td>
              <td>{r.date}<br /><span className="muted small">recorded {formatDateTime(r.timestamp)}</span></td>
              <td><AttendanceBadge value={r.attendance} />{r.source === "face" && <span className="muted small"> face-assisted</span>}</td>
              {showMarkedBy && <td>{r.markedBy}</td>}
              <td><StatusBadge status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
