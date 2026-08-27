import Link from "next/link";
import { fmtKES } from "@/lib/money";

type Milestone = {
  id: number;
  milestoneName: string;
  sequenceOrder: number;
  documentId: number | null;
  docStatus: string | null;
  docTotalCents: number | null;
  docPaidCents: number | null;
};

function dotState(m: Milestone): { color: string; label: string } {
  if (!m.documentId) return { color: "bg-[var(--color-ink-200)]", label: "Not yet invoiced" };
  const paid = m.docPaidCents ?? 0;
  const total = m.docTotalCents ?? 0;
  if (total > 0 && paid >= total) return { color: "bg-[var(--color-good)]", label: "Paid" };
  return { color: "bg-[var(--color-warn)]", label: "Awaiting payment" };
}

export function PaymentTimeline({ projectId, milestones }: { projectId: number; milestones: Milestone[] }) {
  if (milestones.length === 0) {
    return (
      <div className="card p-5 flex items-center justify-center text-center">
        <div className="text-[12.5px] text-[var(--color-ink-300)]">
          No payment schedule yet —{" "}
          <Link href={`/projects/${projectId}?tab=payments`} className="text-[var(--color-accent-600)] hover:underline">
            set one up
          </Link>
        </div>
      </div>
    );
  }

  const sorted = [...milestones].sort((a, b) => a.sequenceOrder - b.sequenceOrder);

  return (
    <div className="card p-5">
      <div className="text-[12.5px] font-semibold text-[var(--color-ink-600)] mb-4">Payment milestones</div>
      <div className="relative">
        <div className="absolute left-0 right-0 top-[9px] h-[2px] bg-[var(--color-ink-100)]" />
        <div className="flex justify-between relative">
          {sorted.map((m) => {
            const { color, label } = dotState(m);
            return (
              <Link
                key={m.id}
                href={`/projects/${projectId}?tab=payments`}
                className="flex flex-col items-center gap-1.5 group"
                style={{ maxWidth: `${100 / sorted.length}%` }}
              >
                <span className={`block w-[18px] h-[18px] rounded-full ring-4 ring-white ${color}`} />
                <span className="text-[11px] font-medium text-center group-hover:underline">{m.milestoneName}</span>
                <span className="text-[10.5px] text-[var(--color-ink-400)] text-center">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
