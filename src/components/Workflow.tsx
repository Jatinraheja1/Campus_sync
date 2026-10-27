import { ChevronRight, ClipboardCheck, HardDriveDownload, RefreshCw, Wifi } from "lucide-react";

const STEPS = [
  { icon: ClipboardCheck, title: "Mark attendance", text: "Works with or without internet" },
  { icon: HardDriveDownload, title: "Save locally", text: "Kept in browser storage" },
  { icon: Wifi, title: "Internet restored", text: "Connection comes back" },
  { icon: RefreshCw, title: "Sync pending records", text: "Upload saved records" },
];

export default function Workflow({ active }: { active?: number }) {
  return (
    <section className="card workflow" aria-label="Offline workflow">
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.title} className={i === active ? "active" : ""}>
            <span className="wf-icon"><s.icon size={18} /></span>
            <span><strong>{s.title}</strong><small>{s.text}</small></span>
            {i < STEPS.length - 1 && <ChevronRight className="wf-arrow" size={18} aria-hidden />}
          </li>
        ))}
      </ol>
    </section>
  );
}
