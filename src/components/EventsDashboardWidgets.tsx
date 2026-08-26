import Link from "next/link";
import { fmtKES } from "@/lib/money";

const statusStyles: Record<string, string> = {
  lead: "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]",
  quoted: "bg-blue-50 text-blue-700",
  confirmed: "bg-violet-50 text-violet-700",
  in_progress: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};
const statusLabels: Record<string, string> = {
  lead: "Lead", quoted: "Quoted", confirmed: "Confirmed", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled",
};

const depositStyles: Record<string, string> = {
  none: "bg-[var(--color-ink-100)] text-[var(--color-ink-400)]",
  unbilled: "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]",
  draft: "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]",
  open: "bg-amber-50 text-amber-700",
  partial: "bg-amber-50 text-amber-700",
  paid: "bg-emerald-50 text-emerald-700",
  overdue: "bg-red-50 text-red-700",
};
const depositLabels: Record<string, string> = {
  none: "No schedule", unbilled: "Not yet invoiced", draft: "Draft invoice", open: "Deposit unpaid", partial: "Partly paid", paid: "Deposit paid",
};

type EventRow = { id: number; name: string; venue: string | null; eventDate: string; status: string; clientName: string | null; depositStatus: string };

export function ThisWeeksEvents({ events }: { events: EventRow[] }) {
  return (
    <div>
      <h2 className="text-[15px] font-semibold mb-3">This week&apos;s events</h2>
      {events.length === 0 ? (
        <div className="card px-6 py-8 text-center text-[13px] text-[var(--color-ink-400)]">Nothing on the calendar in the next 7 days.</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {events.map((e) => (
            <Link key={e.id} href={`/projects/${e.id}`} className="card px-4 py-3 min-w-[220px] shrink-0 hover:bg-[var(--color-ink-50)] transition-colors">
              <div className="font-medium text-[13.5px] truncate">{e.name}</div>
              <div className="text-[11.5px] text-[var(--color-ink-400)] mt-0.5">{e.eventDate}{e.venue ? ` · ${e.venue}` : ""}</div>
              <div className="text-[11.5px] text-[var(--color-ink-500)] mt-0.5">{e.clientName ?? "No client yet"}</div>
              <div className="flex items-center gap-1.5 mt-2">
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium ${statusStyles[e.status] ?? statusStyles.lead}`}>{statusLabels[e.status] ?? e.status}</span>
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium ${depositStyles[e.depositStatus] ?? depositStyles.none}`}>{depositLabels[e.depositStatus] ?? e.depositStatus}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

type RiskRow = { projectId: number; projectName: string; eventDate: string; milestoneName: string; docStatus: string; docTotalCents: number; docPaidCents: number };

export function UnpaidMilestoneRisks({ risks }: { risks: RiskRow[] }) {
  if (risks.length === 0) return null;
  return (
    <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3">
      <div className="text-[12.5px] font-semibold text-[var(--color-bad)] mb-2">⚠ Unpaid milestones with the event date closing in</div>
      <div className="space-y-1.5">
        {risks.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-[12.5px]">
            <Link href={`/projects/${r.projectId}`} className="hover:underline">
              {r.projectName} — {r.milestoneName} <span className="text-[var(--color-ink-400)]">({r.eventDate})</span>
            </Link>
            <span className="text-[var(--color-bad)] font-medium tnum shrink-0 ml-3">{fmtKES(r.docTotalCents - r.docPaidCents)} owed</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OpsSummaryRow({ pendingDamage, manifestCounts }: { pendingDamage: number; manifestCounts: Record<string, number> }) {
  const total = Object.entries(manifestCounts).filter(([status]) => status !== "reconciled").reduce((sum, [, count]) => sum + count, 0);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Link href="/projects/damage-reports" className="card px-4 py-3 hover:bg-[var(--color-ink-50)] transition-colors">
        <div className="text-[11.5px] text-[var(--color-ink-500)]">Pending damage reports</div>
        <div className={`text-[20px] font-semibold mt-0.5 ${pendingDamage > 0 ? "text-[var(--color-bad)]" : ""}`}>{pendingDamage}</div>
      </Link>
      <Link href="/manifests" className="card px-4 py-3 hover:bg-[var(--color-ink-50)] transition-colors">
        <div className="text-[11.5px] text-[var(--color-ink-500)]">Draft manifests</div>
        <div className="text-[20px] font-semibold mt-0.5">{manifestCounts.draft ?? 0}</div>
      </Link>
      <Link href="/manifests" className="card px-4 py-3 hover:bg-[var(--color-ink-50)] transition-colors">
        <div className="text-[11.5px] text-[var(--color-ink-500)]">In progress</div>
        <div className="text-[20px] font-semibold mt-0.5">{manifestCounts.in_progress ?? 0}</div>
      </Link>
      <Link href="/manifests" className="card px-4 py-3 hover:bg-[var(--color-ink-50)] transition-colors">
        <div className="text-[11.5px] text-[var(--color-ink-500)]">Total live manifests</div>
        <div className="text-[20px] font-semibold mt-0.5">{total}</div>
      </Link>
    </div>
  );
}

export function SalesPipelineFunnel({ counts }: { counts: Record<string, number> }) {
  const order = ["lead", "quoted", "confirmed", "in_progress", "completed"] as const;
  return (
    <div>
      <h2 className="text-[15px] font-semibold mb-3">Pipeline</h2>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {order.map((s) => (
          <Link key={s} href="/projects" className="card px-4 py-3 hover:bg-[var(--color-ink-50)] transition-colors">
            <div className="text-[11.5px] text-[var(--color-ink-500)]">{statusLabels[s]}</div>
            <div className="text-[20px] font-semibold mt-0.5">{counts[s] ?? 0}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
