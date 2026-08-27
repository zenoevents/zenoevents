import { fmtKES } from "@/lib/money";

export function CostBreakdown({ operationalCents, damageWriteoffCents }: { operationalCents: number; damageWriteoffCents: number }) {
  const total = operationalCents + damageWriteoffCents;

  return (
    <div className="card p-5">
      <div className="text-[12.5px] font-semibold text-[var(--color-ink-600)] mb-3">Cost so far</div>
      {total === 0 ? (
        <div className="text-[12.5px] text-[var(--color-ink-300)]">No costs recorded yet</div>
      ) : (
        <>
          <div className="h-2.5 rounded-full bg-[var(--color-ink-100)] overflow-hidden flex mb-3">
            <div className="h-full bg-[var(--color-accent-500)]" style={{ width: `${(operationalCents / total) * 100}%` }} />
            <div className="h-full bg-[var(--color-bad)]" style={{ width: `${(damageWriteoffCents / total) * 100}%` }} />
          </div>
          <div className="space-y-1.5 text-[11.5px]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[var(--color-ink-600)]"><span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent-500)]" />Bills &amp; expenses</span>
              <span className="tnum font-medium">{fmtKES(operationalCents)}</span>
            </div>
            {damageWriteoffCents > 0 && (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[var(--color-ink-600)]"><span className="inline-block w-2 h-2 rounded-full bg-[var(--color-bad)]" />Damage write-off</span>
                <span className="tnum font-medium">{fmtKES(damageWriteoffCents)}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
