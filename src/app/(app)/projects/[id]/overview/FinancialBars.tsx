import { fmtKES } from "@/lib/money";

export function FinancialBars({
  budgetCents,
  invoicedCents,
  collectedCents,
  marginCents,
}: {
  budgetCents: number;
  invoicedCents: number;
  collectedCents: number;
  marginCents: number;
}) {
  const maxCents = Math.max(budgetCents, invoicedCents, 1);
  const invoicedPct = Math.min(100, (invoicedCents / maxCents) * 100);
  const collectedPct = Math.min(100, (collectedCents / maxCents) * 100);
  const overBudget = invoicedCents > budgetCents && budgetCents > 0;
  const outstandingCents = Math.max(0, invoicedCents - collectedCents);

  const ringRadius = 40;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const collectedFraction = invoicedCents > 0 ? Math.min(1, collectedCents / invoicedCents) : 0;
  const marginPct = invoicedCents > 0 ? Math.round((marginCents / invoicedCents) * 100) : null;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[12.5px] font-semibold text-[var(--color-ink-600)]">Financial health</div>
        {marginPct !== null && (
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              marginPct >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-[var(--color-bad)]"
            }`}
          >
            {marginPct}% margin
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] text-[var(--color-ink-400)]">Budget {fmtKES(budgetCents)}</span>
            {overBudget && (
              <span className="text-[10.5px] font-medium text-[var(--color-bad)]">Invoiced past budget</span>
            )}
          </div>
          <div className="relative h-6 rounded-md bg-[var(--color-ink-100)] overflow-hidden">
            <div
              className={`absolute inset-y-0 left-0 ${overBudget ? "bg-red-200" : "bg-[var(--color-accent-100)]"}`}
              style={{ width: `${invoicedPct}%` }}
            />
            <div className="absolute inset-y-0 left-0 bg-[var(--color-good)]" style={{ width: `${collectedPct}%` }} />
          </div>
          <div className="flex items-center gap-4 mt-2 text-[11px] text-[var(--color-ink-400)]">
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[var(--color-good)]" />Collected {fmtKES(collectedCents)}</span>
            <span className="flex items-center gap-1"><span className={`inline-block w-2 h-2 rounded-full ${overBudget ? "bg-red-300" : "bg-[var(--color-accent-100)]"}`} />Invoiced {fmtKES(invoicedCents)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <svg viewBox="0 0 100 100" width="72" height="72" className="shrink-0">
            <circle cx="50" cy="50" r={ringRadius} fill="none" stroke="var(--color-ink-100)" strokeWidth="10" />
            <circle
              cx="50" cy="50" r={ringRadius} fill="none"
              stroke="var(--color-good)" strokeWidth="10"
              strokeDasharray={`${ringCircumference * collectedFraction} ${ringCircumference}`}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
            />
          </svg>
          <div>
            <div className="text-[11px] text-[var(--color-ink-400)]">Outstanding</div>
            <div className="text-[13px] font-semibold tnum">{fmtKES(outstandingCents)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
