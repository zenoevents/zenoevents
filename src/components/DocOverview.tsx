import Link from "next/link";
import { fmtKES } from "@/lib/money";

/**
 * Invoice & quote status overview — one segmented bar per doc type instead
 * of five separate progress rows, plus money totals below.
 * Server component; data from reports.docStatusOverview.
 */

const C = {
  gray: "#86868b",
  slate: "#515154",
  blue: "#2563eb",
  red: "#c0392b",
  amber: "#b8860b",
  green: "#1f8a4c",
};

function SegmentedBar({ title, segments, total, hrefBase }: {
  title: string;
  segments: { key: string; label: string; count: number; color: string }[];
  total: number;
  hrefBase: string;
}) {
  return (
    <div>
      <div className="text-[13.5px] font-semibold mb-2">{title}</div>
      <div className="h-3 rounded-full bg-[var(--color-ink-100)] overflow-hidden flex">
        {segments.filter((s) => s.count > 0).map((s) => (
          <Link
            key={s.key}
            href={`${hrefBase}?status=${s.key}`}
            title={`${s.label}: ${s.count}`}
            className="h-full transition-opacity hover:opacity-80"
            style={{ width: `${total > 0 ? (s.count / total) * 100 : 0}%`, background: s.color }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
        {segments.map((s) => (
          <Link key={s.key} href={`${hrefBase}?status=${s.key}`} className="flex items-center gap-1.5 text-[12px] group">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="font-semibold tnum" style={{ color: s.color }}>{s.count}</span>
            <span className="text-[var(--color-ink-600)] group-hover:text-[var(--color-ink-900)]">{s.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function DocOverview({
  data,
  year,
  years,
  showBreakdown = true,
}: {
  showBreakdown?: boolean;
  data: {
    inv: { draft: number; open: number; partial: number; overdue: number; paid: number; void: number };
    invTotal: number;
    qt: { draft: number; open: number; accepted: number; declined: number };
    qtTotal: number;
    outstandingCents: number;
    pastDueCents: number;
    paidCents: number;
  };
  year: string;
  years: string[];
}) {
  return (
    <div className="card p-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
        <SegmentedBar
          title="Invoice overview"
          total={data.invTotal}
          hrefBase="/sales/invoices"
          segments={[
            { key: "draft", label: "Draft", count: data.inv.draft, color: C.gray },
            { key: "open", label: "Awaiting payment", count: data.inv.open, color: C.blue },
            { key: "partial", label: "Partially paid", count: data.inv.partial, color: C.amber },
            { key: "overdue", label: "Overdue", count: data.inv.overdue, color: C.red },
            { key: "paid", label: "Paid", count: data.inv.paid, color: C.green },
          ]}
        />
        <SegmentedBar
          title="Quote overview"
          total={data.qtTotal}
          hrefBase="/sales/quotes"
          segments={[
            { key: "draft", label: "Draft", count: data.qt.draft, color: C.gray },
            { key: "open", label: "Sent", count: data.qt.open, color: C.blue },
            { key: "accepted", label: "Accepted", count: data.qt.accepted, color: C.green },
            { key: "declined", label: "Declined", count: data.qt.declined, color: C.red },
          ]}
        />
      </div>

      {showBreakdown && (
      <div className="hairline-t mt-5 pt-4">
        <form className="flex justify-end mb-3">
          <select
            name="year"
            defaultValue={year}
            className="rounded-md border border-[var(--color-ink-200)] px-2 py-1 text-[12.5px] bg-white"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button className="ml-2 rounded-md border border-[var(--color-ink-200)] bg-white px-2.5 py-1 text-[12.5px] font-medium hover:bg-[var(--color-ink-50)]">
            Go
          </button>
        </form>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-[var(--color-ink-100)] px-4 py-3">
            <div className="text-[12px] font-medium" style={{ color: C.amber }}>Outstanding invoices</div>
            <div className="stat-figure text-[17px] font-semibold tnum mt-0.5">{fmtKES(data.outstandingCents)}</div>
          </div>
          <div className="rounded-lg border border-[var(--color-ink-100)] px-4 py-3">
            <div className="text-[12px] font-medium text-[var(--color-ink-600)]">Past due invoices</div>
            <div className="stat-figure text-[17px] font-semibold tnum mt-0.5" style={{ color: data.pastDueCents > 0 ? C.red : undefined }}>
              {fmtKES(data.pastDueCents)}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--color-ink-100)] px-4 py-3">
            <div className="text-[12px] font-medium" style={{ color: C.green }}>Paid invoices</div>
            <div className="stat-figure text-[17px] font-semibold tnum mt-0.5">{fmtKES(data.paidCents)}</div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
