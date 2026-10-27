import type { ReactNode } from "react";

export default function StatCard({ icon, label, value, note, tone }: {
  icon: ReactNode; label: string; value: ReactNode; note?: string; tone: "blue" | "green" | "orange";
}) {
  return (
    <div className={`card stat tone-${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div>
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
        {note && <p className="stat-note">{note}</p>}
      </div>
    </div>
  );
}
