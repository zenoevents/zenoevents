import { EmptyState } from "@/components/ui";
import type { MilestoneEvent } from "@/lib/projects";

export function MilestonesPanel({ events }: { events: MilestoneEvent[] }) {
  if (events.length === 0) {
    return <EmptyState title="Nothing yet" body="As reservations get booked, contracts signed, invoices raised and the manifest moves, this timeline fills in automatically." />;
  }

  return (
    <div className="space-y-0">
      {events.map((e, i) => (
        <div key={i} className={`flex gap-3 py-2.5 ${i === 0 ? "" : "hairline-t"}`}>
          <span className="text-[15px] shrink-0 w-6 text-center">{e.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-[var(--color-ink-900)]">{e.label}</div>
          </div>
          <div className="text-[11.5px] text-[var(--color-ink-400)] tnum shrink-0">{e.date.slice(0, 10)}</div>
        </div>
      ))}
    </div>
  );
}
