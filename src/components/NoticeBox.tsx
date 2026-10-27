import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { Notice } from "../types";

export default function NoticeBox({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  const Icon = notice.kind === "success" ? CheckCircle2 : notice.kind === "error" ? AlertTriangle : Info;
  return (
    <div className={`notice notice-${notice.kind}`} role="status">
      <Icon size={18} /> <span>{notice.text}</span>
    </div>
  );
}
