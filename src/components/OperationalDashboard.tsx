import Link from "next/link";
import { LINE_STATUS_LABELS } from "@/lib/manifest-status";

type Task = {
  lineId: number;
  status: string;
  description: string;
  qtyRequested: number;
  projectId: number;
  projectName: string;
  eventDate: string;
};

/** Today-only, nothing else — the loading/collection/warehouse staff
 *  dashboard from the events-vertical brainstorm. No financials, no
 *  calendar, no other staff's work. */
export function OperationalDashboard({
  orgName,
  tasks,
  warehouse,
}: {
  orgName: string;
  tasks: Task[];
  warehouse?: { pendingPick: number; awaitingInspection: number };
}) {
  return (
    <div className="max-w-2xl">
      <h1 className="text-[22px] font-semibold tracking-tight mb-1">Good {greeting()}</h1>
      <p className="text-[13px] text-[var(--color-ink-400)] mb-6">{orgName}</p>

      {warehouse && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Link href="/manifests" className="card px-4 py-3 hover:bg-[var(--color-ink-50)] transition-colors">
            <div className="text-[11.5px] text-[var(--color-ink-500)]">Waiting to be picked</div>
            <div className={`text-[24px] font-semibold mt-0.5 ${warehouse.pendingPick > 0 ? "text-[var(--color-warn)]" : ""}`}>{warehouse.pendingPick}</div>
          </Link>
          <Link href="/manifests" className="card px-4 py-3 hover:bg-[var(--color-ink-50)] transition-colors">
            <div className="text-[11.5px] text-[var(--color-ink-500)]">Returned, awaiting inspection</div>
            <div className={`text-[24px] font-semibold mt-0.5 ${warehouse.awaitingInspection > 0 ? "text-[var(--color-warn)]" : ""}`}>{warehouse.awaitingInspection}</div>
          </Link>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold">Today&apos;s tasks</h2>
        <Link href="/manifests" className="text-[12.5px] text-[var(--color-accent-600)] hover:underline">View all</Link>
      </div>

      {tasks.length === 0 ? (
        <div className="card px-6 py-10 text-center text-[13px] text-[var(--color-ink-400)]">Nothing waiting on you right now.</div>
      ) : (
        <div className="space-y-2">
          {tasks.slice(0, 8).map((t) => (
            <Link key={t.lineId} href={`/projects/${t.projectId}/manifest`} className="block card px-4 py-3 hover:bg-[var(--color-ink-50)] transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-[13.5px]">{t.description}</div>
                  <div className="text-[11.5px] text-[var(--color-ink-400)] mt-0.5">{t.projectName} · {t.eventDate} · qty {t.qtyRequested}</div>
                </div>
                <span className="text-[11px] font-medium shrink-0 rounded-full px-2.5 py-1 bg-[var(--color-ink-100)] text-[var(--color-ink-600)]">
                  {LINE_STATUS_LABELS[t.status] ?? t.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
