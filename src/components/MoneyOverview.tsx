import { fmtKES } from "@/lib/money";
import { StatCard } from "@/components/ui";

/** Tiny inline sparkline — plain SVG polyline, no chart library. Built
 *  from the same income series already fetched for the bar chart, so it's
 *  an honest "6-month income trend," not a fabricated receivables history. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const range = Math.max(1, max - min);
  const w = 100;
  const h = 28;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100" height="28" preserveAspectRatio="none" className="opacity-90">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MoneyOverview({
  cashCents,
  receivablesCents,
  overdueReceivablesCents,
  payablesCents,
  netVatDueCents,
  incomeTrend,
}: {
  cashCents: number;
  receivablesCents: number;
  overdueReceivablesCents: number;
  payablesCents: number;
  netVatDueCents: number;
  incomeTrend: number[];
}) {
  const upcomingCents = Math.max(0, receivablesCents - overdueReceivablesCents);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* Money you're owed — the biggest lever in an event business, given visual weight */}
      <div className="card p-5 sm:col-span-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[12.5px] text-[var(--color-ink-600)]">Money you&apos;re owed</div>
            <div className="stat-figure money-lg mt-1">{fmtKES(receivablesCents)}</div>
            <div className="flex items-center gap-4 mt-2.5 text-[12px]">
              <span className={overdueReceivablesCents > 0 ? "text-[var(--color-warn)] font-medium" : "text-[var(--color-ink-400)]"}>
                {fmtKES(overdueReceivablesCents)} overdue
              </span>
              <span className="text-[var(--color-ink-400)]">{fmtKES(upcomingCents)} upcoming</span>
            </div>
          </div>
          <div className="text-[var(--color-accent-500)] shrink-0 text-right">
            <Sparkline values={incomeTrend} />
            <div className="text-[10px] text-[var(--color-ink-400)] mt-0.5">6-mo income trend</div>
          </div>
        </div>
      </div>

      <StatCard label="Cash & M-Pesa" hint="across all money accounts" cents={cashCents} />

      <StatCard label="Money you owe" hint="accounts payable" cents={payablesCents} />
      <StatCard
        label="VAT due to KRA"
        hint="this month so far"
        cents={netVatDueCents}
        tone={netVatDueCents > 0 ? "warn" : "good"}
      />
    </div>
  );
}
