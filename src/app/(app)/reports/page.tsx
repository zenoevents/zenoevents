import Link from "next/link";
import { requirePerm } from "@/lib/guard";
import { PageHeader } from "@/components/ui";
import { dashboardStats, monthlyIncomeExpense, businessRatios } from "@/lib/reports";
import { fmtKES, todayISO } from "@/lib/money";
import { withOrg } from "@/lib/org";
import { IncomeExpenseChart } from "@/components/IncomeExpenseChart";

export const dynamic = "force-dynamic";

const reports = [
  {
    group: "Sales",
    items: [
      { href: "/reports/sales", title: "Sales Reports", body: "Detailed breakdown of invoices, items, and customers." },
    ],
  },
  {
    group: "Performance",
    items: [
      { href: "/reports/pnl", title: "Profit & Loss", body: "Income minus spending — did you make money?" },
      { href: "/reports/income-expense", title: "Income vs Expense", body: "Monthly breakdown over the last 12 months." },
      { href: "/reports/cash-flow", title: "Cash Flow Statement", body: "Simplified cash movement grouped by activity." },
    ],
  },
  {
    group: "Position",
    items: [
      { href: "/reports/balance-sheet", title: "Balance Sheet", body: "What you own vs what you owe, right now." },
      { href: "/reports/aging", title: "Aged Receivables (Aging)", body: "Unpaid invoices and bills, bucketed by lateness." },
      { href: "/reports/debtors", title: "Debtors", body: "Every customer with a balance outstanding, per sales agent, in one list." },
      { href: "/reports/petty-expenses", title: "Petty Expenses", body: "Staff expense claims by person and category, for easy reimbursement." },
    ],
  },
  {
    group: "Detailed & Compliance",
    items: [
      { href: "/reports/general-ledger", title: "General Ledger", body: "Detailed transaction history for specific accounts." },
      { href: "/reports/trial-balance", title: "Trial Balance", body: "Every account's debits and credits — for your accountant." },
      { href: "/reports/vat", title: "VAT Return (VAT 3) prep", body: "Output VAT vs input VAT for the period." },
      { href: "/reports/wht", title: "Withholding Tax Report", body: "Tax withheld by customers, with date filters and CSV/PDF export." },
    ],
  },
];

export default async function ReportsPage() {
  await requirePerm("reports");

  const today = todayISO();
  const [stats, incomeExpenseData, ratios] = await Promise.all([
    withOrg(() => dashboardStats(today)),
    withOrg(() => monthlyIncomeExpense(6)),
    withOrg(() => businessRatios(today)),
  ]);

  const totalIncome = stats.incomeThisMonthCents;
  const netIncome = stats.incomeThisMonthCents - stats.expensesThisMonthCents;
  const profitMargin = totalIncome > 0 ? ((netIncome / totalIncome) * 100).toFixed(1) + "%" : "—";

  const fmtRatio = (r: number | null) => (r === null ? "—" : r.toFixed(2));
  const fmtPct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);

  return (
    <>
      <PageHeader title="Reports & Dashboard" subtitle="Financial overview and detailed statements" />
      
      {/* iOS Inspired Mini Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-8">
        
        {/* Quick Looks (Metrics) */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          <div className="card p-5 bg-gradient-to-br from-[var(--color-ink-50)] to-white">
            <div className="text-[12.5px] font-semibold text-[var(--color-ink-500)] uppercase tracking-wider mb-1">Revenue (MTD)</div>
            <div className="text-2xl font-bold text-[var(--color-ink-900)]">{fmtKES(totalIncome)}</div>
          </div>
          
          <div className="card p-5 bg-gradient-to-br from-[var(--color-ink-50)] to-white">
            <div className="text-[12.5px] font-semibold text-[var(--color-ink-500)] uppercase tracking-wider mb-1">Net Income (MTD)</div>
            <div className={`text-2xl font-bold ${netIncome >= 0 ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>
              {fmtKES(netIncome)}
            </div>
          </div>

          <div className="card p-5 bg-gradient-to-br from-[var(--color-ink-50)] to-white">
            <div className="text-[12.5px] font-semibold text-[var(--color-ink-500)] uppercase tracking-wider mb-1">Receivables</div>
            <div className="text-2xl font-bold text-[var(--color-ink-900)]">{fmtKES(stats.receivablesCents)}</div>
          </div>

          <div className="card p-5 bg-gradient-to-br from-[var(--color-ink-50)] to-white">
            <div className="text-[12.5px] font-semibold text-[var(--color-ink-500)] uppercase tracking-wider mb-1">Payables</div>
            <div className="text-2xl font-bold text-[var(--color-ink-900)]">{fmtKES(stats.payablesCents)}</div>
            <div className="text-[11.5px] text-[var(--color-ink-400)] mt-1">
              to vendors — VAT payable to KRA{" "}
              <span className={stats.vatPayableCents > 0 ? "text-[var(--color-bad)] font-medium" : "font-medium"}>
                {fmtKES(stats.vatPayableCents)}
              </span>{" "}
              is separate
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-1">
            <div className="card p-4">
              <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Profit Margin</div>
              <div className="text-lg font-bold mt-1">{profitMargin}</div>
            </div>
            <div className="card p-4">
              <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Cash on hand</div>
              <div className="text-lg font-bold mt-1">{fmtKES(stats.cashCents)}</div>
            </div>
          </div>

          <Link href="/reports/vat3" className="card p-4 border border-[var(--color-ink-200)] hover:border-[var(--color-ink-400)] transition-colors">
            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-500)]">Tax Filing</div>
            <div className="text-md font-bold mt-1">VAT3 iTax Prefill</div>
          </Link>
        </div>

        {/* Chart — flex column so the chart fills the card's full stretched
            height (matches the taller stacked-metrics column beside it)
            instead of sitting height-locked in a mostly-blank card. */}
        <div className="lg:col-span-2 card p-5 flex flex-col">
          <h2 className="text-[14px] font-semibold mb-4">Income vs Expense (6 Months)</h2>
          <IncomeExpenseChart data={incomeExpenseData} />
        </div>
      </div>

      {/* Business ratios — computed straight from the chart of accounts, not
          approximated from the dashboard rollup. */}
      <div className="mb-8">
        <h2 className="text-[13px] font-semibold text-[var(--color-ink-600)] mb-3">
          Business Ratios <span className="font-normal text-[var(--color-ink-400)]">as of {today}</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="card p-4">
            <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Working Capital</div>
            <div className={`text-lg font-bold mt-1 ${ratios.workingCapitalCents < 0 ? "text-[var(--color-bad)]" : ""}`}>
              {fmtKES(ratios.workingCapitalCents)}
            </div>
          </div>
          <div className="card p-4">
            <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Working Capital Ratio</div>
            <div className="text-lg font-bold mt-1">{fmtRatio(ratios.workingCapitalRatio)}</div>
            <div className="text-[10.5px] text-[var(--color-ink-400)] mt-0.5">current assets ÷ current liabilities</div>
          </div>
          <div className="card p-4">
            <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Debt Ratio</div>
            <div className="text-lg font-bold mt-1">{fmtPct(ratios.debtRatio)}</div>
            <div className="text-[10.5px] text-[var(--color-ink-400)] mt-0.5">total liabilities ÷ total assets</div>
          </div>
          <div className="card p-4">
            <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Assets-to-Equity</div>
            <div className="text-lg font-bold mt-1">{fmtRatio(ratios.assetsToEquityRatio)}</div>
            <div className="text-[10.5px] text-[var(--color-ink-400)] mt-0.5">total assets ÷ total equity</div>
          </div>
          <div className="card p-4">
            <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Debt-to-Equity</div>
            <div className="text-lg font-bold mt-1">{fmtRatio(ratios.debtToEquityRatio)}</div>
            <div className="text-[10.5px] text-[var(--color-ink-400)] mt-0.5">total liabilities ÷ total equity</div>
          </div>
          <div className="card p-4">
            <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Overdue Receivables</div>
            <div className={`text-lg font-bold mt-1 ${stats.overdueReceivablesCents > 0 ? "text-[var(--color-bad)]" : ""}`}>
              {fmtKES(stats.overdueReceivablesCents)}
            </div>
          </div>
          <div className="card p-4">
            <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Current Assets</div>
            <div className="text-lg font-bold mt-1">{fmtKES(ratios.currentAssetsCents)}</div>
          </div>
          <div className="card p-4">
            <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Current Liabilities</div>
            <div className="text-lg font-bold mt-1">{fmtKES(ratios.currentLiabilitiesCents)}</div>
          </div>
          <div className="card p-4">
            <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Total Assets</div>
            <div className="text-lg font-bold mt-1">{fmtKES(ratios.totalAssetsCents)}</div>
          </div>
          <div className="card p-4">
            <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Total Liabilities</div>
            <div className="text-lg font-bold mt-1">{fmtKES(ratios.totalLiabilitiesCents)}</div>
          </div>
          <div className="card p-4">
            <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Total Equity</div>
            <div className="text-lg font-bold mt-1">{fmtKES(ratios.totalEquityCents)}</div>
          </div>
          <div className="card p-4">
            <div className="text-[11.5px] text-[var(--color-ink-500)] uppercase">Net VAT Due</div>
            <div className="text-lg font-bold mt-1">{fmtKES(stats.netVatDueCents)}</div>
          </div>
        </div>
      </div>

      <div className="h-px w-full bg-[var(--color-ink-200)] mb-8"></div>

      {/* Reports List */}
      {reports.map((g) => (
        <div key={g.group} className="mb-7">
          <h2 className="text-[13px] font-semibold text-[var(--color-ink-600)] mb-3">{g.group}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {g.items.map((r) => (
              <Link key={r.href} href={r.href} className="card px-5 py-4 hover:shadow-md transition-all hover:-translate-y-0.5 border-[var(--color-ink-200)]">
                <div className="text-[14px] font-semibold text-[var(--color-ink-900)] flex items-center justify-between">
                  {r.title}
                  <span className="text-[var(--color-ink-300)]">→</span>
                </div>
                <p className="text-[12.5px] text-[var(--color-ink-500)] mt-1.5">{r.body}</p>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
