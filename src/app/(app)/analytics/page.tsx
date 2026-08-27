import { requirePerm } from "@/lib/guard";
import { getOrg, withOrg } from "@/lib/org";
import { PageHeader } from "@/components/ui";
import { fmtKES } from "@/lib/money";
import { db, items, employees, projects } from "@/db";
import { eq, and } from "drizzle-orm";
import * as A from "@/lib/analytics";
import { aging } from "@/lib/reports";
import {
  TrendAreaChart, TrendLineChart, RankBarChart, CategoryBarChart, StackedBarChart, BreakdownDonut,
  RadialRingChart, RadialTrendChart, NestedDonut, RangeBarChart, BudgetScatterChart, FlowSankey, RadarProfileChart, FunnelStages,
} from "@/components/analytics/Charts";
import { LockedCard } from "@/components/analytics/LockedCard";
import { fakeTrend, fakeRanked, fakeBuckets, fakeStacked } from "./placeholders";

export const dynamic = "force-dynamic";

// Every section is available to any active org now — no more reporting-tier
// ladder. Kept as an inert lookup only because LockedCard still needs a
// planLabel prop; `has()` below always returns true so it never renders.
const TIER_LABEL = { basic: "Free", standard: "Standard", advanced: "Business" };

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="text-[13.5px] font-semibold">{title}</h3>
      {subtitle && <p className="text-[11.5px] text-[var(--color-ink-400)] mt-0.5 mb-1">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return <h2 className="text-[15px] font-semibold tracking-tight pt-2">{title}</h2>;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="card px-5 py-4">
      <div className="text-[12px] text-[var(--color-ink-600)]">{label}</div>
      <div className={`text-[22px] font-semibold tnum mt-1 ${tone === "good" ? "text-[var(--color-good)]" : tone === "bad" ? "text-[var(--color-bad)]" : tone === "warn" ? "text-[var(--color-warn)]" : ""}`}>
        {value}
      </div>
      {sub && <div className="text-[11.5px] text-[var(--color-ink-400)] mt-1">{sub}</div>}
    </div>
  );
}

export default async function AnalyticsPage() {
  await requirePerm("reports");
  const o = await getOrg();
  const has = (_need?: string) => true;

  const [hasInventory, hasEmployees, hasEvents] = await withOrg(() =>
    Promise.all([
      db.select({ id: items.id }).from(items).where(and(eq(items.orgId, o.id), eq(items.trackInventory, true))).limit(1).then((r) => r.length > 0),
      db.select({ id: employees.id }).from(employees).where(eq(employees.orgId, o.id)).limit(1).then((r) => r.length > 0),
      db.select({ id: projects.id }).from(projects).where(eq(projects.orgId, o.id)).limit(1).then((r) => r.length > 0),
    ])
  );

  const [
    marginByType, seasonalCurve, bookingsByType, leadTimeRange,
    budgetScatter, billingFlow, perfProfile, funnelStages,
  ] = hasEvents
    ? await withOrg(() =>
        Promise.all([
          A.marginByEventType(),
          A.seasonalBookingCurve(),
          A.bookingsByTypeAndStatus(),
          A.bookingLeadTimeRange(),
          A.budgetVsActualScatter(),
          A.bookingToBillingFlow(),
          A.eventTypePerformanceProfile(),
          A.salesFunnelStages(),
        ])
      )
    : [[], [], { outer: [], inner: [] }, [], [], { nodes: [], links: [] }, { data: [], series: [] }, []];

  // Fetch only what the plan entitles — locked tiles get placeholder shapes, never real numbers.
  const [
    revenue, topCust, topItemsData, quoteConv,
    arAging, cashFlow, dsoData, bankTrend,
    expBreak, vendors, apAging, claimsStats,
    margin, profitByCust,
    stockValue, movers, dead,
    payrollTrend, hires, hours,
    pipeline, newVsRet,
    vatTrend, whtTrend, health,
  ] = await withOrg(() =>
    Promise.all([
      A.revenueTrend(12),
      A.topCustomers(8),
      has("standard") ? A.topItems(8) : Promise.resolve(null),
      has("standard") ? A.quoteConversion(6) : Promise.resolve(null),
      aging("invoice", new Date().toISOString().slice(0, 10)),
      has("standard") ? A.cashFlowTrend(12) : Promise.resolve(null),
      has("standard") ? A.dso() : Promise.resolve(null),
      A.bankBalanceTrend(12),
      A.expenseBreakdown(12),
      has("standard") ? A.topVendors(8) : Promise.resolve(null),
      has("standard") ? aging("bill", new Date().toISOString().slice(0, 10)) : Promise.resolve(null),
      has("standard") ? A.expenseClaimsStats() : Promise.resolve(null),
      has("standard") ? A.marginTrend(12) : Promise.resolve(null),
      has("advanced") ? A.profitabilityByCustomer(10) : Promise.resolve(null),
      hasInventory && has("standard") ? A.stockValueByItem(8) : Promise.resolve(null),
      hasInventory && has("standard") ? A.fastSlowMovers(6) : Promise.resolve(null),
      hasInventory && has("standard") ? A.deadStock(60, 8) : Promise.resolve(null),
      hasEmployees && has("advanced") ? A.payrollCostTrend(12) : Promise.resolve(null),
      hasEmployees && has("advanced") ? A.newHiresTrend(12) : Promise.resolve(null),
      o.timeTrackingEnabled && has("advanced") ? A.timeTrackingHours(8) : Promise.resolve(null),
      has("standard") ? A.pipelineByStage() : Promise.resolve(null),
      has("standard") ? A.newVsReturningCustomers(12) : Promise.resolve(null),
      A.vatPositionTrend(12),
      A.whtPositionTrend(12),
      A.booksHealth(o.lockDate),
    ])
  );

  const brand = "var(--color-brand, #0f766e)";

  return (
    <>
      <PageHeader title="Analytics" subtitle="Everything the system knows about your business, in one place." />

      <div className="space-y-8 pb-10">
        {/* Revenue */}
        <div className="space-y-4">
          <Section title="Revenue" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Revenue trend" subtitle="This year vs last year">
              <TrendAreaChart
                data={revenue.map((r) => ({ label: r.label, thisYear: r.revenueCents, lastYear: r.revenuePrevYearCents }))}
                series={[
                  { key: "thisYear", label: "This year", color: brand },
                  { key: "lastYear", label: "Last year", color: "#d2d2d7", dashed: true },
                ]}
              />
            </Card>
            <Card title="Top customers" subtitle="By revenue, all time">
              <RankBarChart data={topCust.map((c) => ({ name: c.name, value: c.revenueCents }))} />
            </Card>
            <LockedCard locked={!has("standard")} planLabel={TIER_LABEL.standard}>
              <Card title="Top items & services" subtitle="By net revenue">
                <RankBarChart data={(topItemsData ?? fakeRanked(8)).map((i: any) => ({ name: i.name, value: i.revenueCents ?? i.value }))} />
              </Card>
            </LockedCard>
            <LockedCard locked={!has("standard")} planLabel={TIER_LABEL.standard}>
              <Card title="Quote conversion rate" subtitle="Accepted ÷ total quotes, monthly">
                {quoteConv ? (
                  <>
                    <div className="text-[28px] font-semibold tnum">{quoteConv.overallRate}%</div>
                    <div className="text-[11.5px] text-[var(--color-ink-400)] mb-2">{quoteConv.acceptedAll} of {quoteConv.totalAll} quotes accepted (6mo)</div>
                    <CategoryBarChart data={quoteConv.series.map((s) => ({ label: s.label, value: s.rate }))} money={false} height={120} color={brand} />
                  </>
                ) : (
                  <>
                    <div className="text-[28px] font-semibold tnum">62%</div>
                    <CategoryBarChart data={fakeTrend(6).map((d) => ({ label: d.label, value: 50 + (d.a % 30) }))} money={false} height={120} color={brand} />
                  </>
                )}
              </Card>
            </LockedCard>
          </div>
        </div>

        {/* Cash & Collections */}
        <div className="space-y-4">
          <Section title="Cash & Collections" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Receivables aging" subtitle={`${fmtKES(arAging.total)} outstanding`}>
              <CategoryBarChart
                data={[
                  { label: "Not due", value: arAging.buckets.current },
                  { label: "1–30d", value: arAging.buckets.d1_30 },
                  { label: "31–60d", value: arAging.buckets.d31_60 },
                  { label: "61–90d", value: arAging.buckets.d61_90 },
                  { label: "90d+", value: arAging.buckets.d90plus },
                ]}
                color="#c0392b"
              />
            </Card>
            <Card title="Bank & cash balance" subtitle="Trailing 12 months">
              <TrendAreaChart data={bankTrend.map((b) => ({ label: b.label, balance: b.balanceCents }))} series={[{ key: "balance", label: "Balance", color: brand }]} />
            </Card>
            <LockedCard locked={!has("standard")} planLabel={TIER_LABEL.standard}>
              <Card title="Cash flow trend" subtitle="Net operating cash, monthly">
                <TrendAreaChart
                  data={(cashFlow ?? fakeTrend(12)).map((c: any) => ({ label: c.label, cash: c.netChangeCents ?? c.a }))}
                  series={[{ key: "cash", label: "Net change", color: brand }]}
                />
              </Card>
            </LockedCard>
            <LockedCard locked={!has("standard")} planLabel={TIER_LABEL.standard}>
              <Card title="Days Sales Outstanding" subtitle="Lower is better — how fast you collect">
                <div className="text-[32px] font-semibold tnum">{dsoData ? dsoData.days : 34}<span className="text-[15px] text-[var(--color-ink-400)] font-normal"> days</span></div>
                <div className="text-[11.5px] text-[var(--color-ink-400)] mt-1">Based on trailing 90-day revenue vs current AR</div>
              </Card>
            </LockedCard>
          </div>
        </div>

        {/* Expenses */}
        <div className="space-y-4">
          <Section title="Expenses" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Expense breakdown" subtitle="Trailing 12 months, by category">
              {expBreak.length > 0 ? (
                <BreakdownDonut data={expBreak} />
              ) : (
                <div className="text-[13px] text-[var(--color-ink-400)] py-10 text-center">No expenses recorded yet.</div>
              )}
            </Card>
            <LockedCard locked={!has("standard")} planLabel={TIER_LABEL.standard}>
              <Card title="Top vendors" subtitle="By spend, all time">
                <RankBarChart data={(vendors ?? fakeRanked(8)).map((v: any) => ({ name: v.name, value: v.spendCents ?? v.value }))} />
              </Card>
            </LockedCard>
            <LockedCard locked={!has("standard")} planLabel={TIER_LABEL.standard}>
              <Card title="Payables aging" subtitle={apAging ? `${fmtKES(apAging.total)} owed` : undefined}>
                <CategoryBarChart
                  data={
                    apAging
                      ? [
                          { label: "Not due", value: apAging.buckets.current },
                          { label: "1–30d", value: apAging.buckets.d1_30 },
                          { label: "31–60d", value: apAging.buckets.d31_60 },
                          { label: "61–90d", value: apAging.buckets.d61_90 },
                          { label: "90d+", value: apAging.buckets.d90plus },
                        ]
                      : fakeBuckets()
                  }
                  color="#c0392b"
                />
              </Card>
            </LockedCard>
            <LockedCard locked={!has("standard")} planLabel={TIER_LABEL.standard}>
              <Card title="Expense claims" subtitle="Staff reimbursement activity">
                {claimsStats ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Tile label="Pending" value={String(claimsStats.byStatus.pending)} tone={claimsStats.byStatus.pending > 0 ? "warn" : undefined} />
                    <Tile label="Approved" value={String(claimsStats.byStatus.approved)} tone="good" />
                    <Tile label="Paid & Settled" value={String(claimsStats.byStatus.paid)} tone="good" sub={fmtKES(claimsStats.paidCents)} />
                    <Tile label="Total Claims Value" value={fmtKES(claimsStats.totalCents)} sub={`${claimsStats.total} total claim(s)`} />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Tile label="Pending" value="3" />
                    <Tile label="Approved" value="12" />
                    <Tile label="Paid & Settled" value="10" sub="KES 45,000" />
                    <Tile label="Total Claims Value" value="KES 65,000" sub="25 total claims" />
                  </div>
                )}
              </Card>
            </LockedCard>
          </div>
        </div>

        {/* Profitability */}
        <div className="space-y-4">
          <Section title="Profitability" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <LockedCard locked={!has("standard")} planLabel={TIER_LABEL.standard}>
              <Card title="Margin trend" subtitle="Gross vs net margin, monthly">
                <TrendLineChart
                  data={(margin ?? fakeTrend(12)).map((m: any) => ({ label: m.label, gross: m.grossMarginPct ?? 45 + (m.a % 15), net: m.netMarginPct ?? 20 + (m.b % 10) }))}
                  series={[
                    { key: "gross", label: "Gross margin", color: brand },
                    { key: "net", label: "Net margin", color: "#5eead4" },
                  ]}
                  suffix="%"
                />
              </Card>
            </LockedCard>
            <LockedCard locked={!has("advanced")} planLabel={TIER_LABEL.advanced}>
              <Card title="Profitability by customer" subtitle="Revenue minus cost of goods sold">
                <RankBarChart data={(profitByCust ?? fakeRanked(8)).map((c: any) => ({ name: c.name, value: c.profitCents ?? c.value }))} />
              </Card>
            </LockedCard>
          </div>
        </div>

        {/* Inventory */}
        {(hasInventory || !has("standard")) && (
          <div className="space-y-4">
            <Section title="Inventory" />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <LockedCard locked={!has("standard")} planLabel={TIER_LABEL.standard}>
                <Card title="Stock value" subtitle="Current, by item">
                  <RankBarChart data={(stockValue?.rows ?? fakeRanked(6)).map((s: any) => ({ name: s.name, value: s.valueCents ?? s.value }))} />
                </Card>
              </LockedCard>
              <LockedCard locked={!has("standard")} planLabel={TIER_LABEL.standard}>
                <Card title="Fastest movers" subtitle="90-day turnover">
                  <RankBarChart data={(movers?.fastest ?? fakeRanked(6, 8)).map((m: any) => ({ name: m.name, value: m.qtySold90d ?? m.value }))} money={false} />
                </Card>
              </LockedCard>
              <LockedCard locked={!has("standard")} planLabel={TIER_LABEL.standard}>
                <Card title="Dead stock" subtitle="No sales in 60 days">
                  <RankBarChart data={(dead ?? fakeRanked(6)).map((d: any) => ({ name: d.name, value: d.valueCents ?? d.value }))} />
                </Card>
              </LockedCard>
            </div>
          </div>
        )}

        {/* Staff & Payroll */}
        {(hasEmployees || !has("advanced")) && (
          <div className="space-y-4">
            <Section title="Staff & Payroll" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <LockedCard locked={!has("advanced")} planLabel={TIER_LABEL.advanced}>
                <Card title="Payroll cost trend" subtitle="Gross pay, monthly">
                  <CategoryBarChart data={(payrollTrend ?? fakeTrend(12)).map((p: any) => ({ label: p.label, value: p.grossCents ?? p.a }))} color={brand} />
                </Card>
              </LockedCard>
              <LockedCard locked={!has("advanced")} planLabel={TIER_LABEL.advanced}>
                <Card title="Hiring & headcount" subtitle={hires ? `${hires.activeHeadcount} active employees` : "8 active employees"}>
                  <CategoryBarChart data={(hires?.series ?? fakeTrend(12).map((d) => ({ label: d.label, value: d.a % 3 }))).map((h: any) => ({ label: h.label, value: h.hires ?? h.value }))} money={false} color={brand} />
                </Card>
              </LockedCard>
              {o.timeTrackingEnabled && (
                <LockedCard locked={!has("advanced")} planLabel={TIER_LABEL.advanced}>
                  <Card title="Hours logged per staff" subtitle="Last 8 weeks">
                    <RankBarChart data={(hours ?? fakeRanked(6, 40)).map((h: any) => ({ name: h.name, value: h.hours ?? h.value }))} money={false} />
                  </Card>
                </LockedCard>
              )}
            </div>
          </div>
        )}

        {/* CRM */}
        <div className="space-y-4">
          <Section title="Pipeline & Customers" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <LockedCard locked={!has("standard")} planLabel={TIER_LABEL.standard}>
              <Card title="Pipeline by stage" subtitle={pipeline ? `${pipeline.winRate}% win rate` : "58% win rate"}>
                <CategoryBarChart
                  data={(pipeline?.stages ?? [
                    { stage: "lead", valueCents: 300000 }, { stage: "qualified", valueCents: 220000 },
                    { stage: "proposal", valueCents: 150000 }, { stage: "negotiation", valueCents: 90000 },
                    { stage: "won", valueCents: 60000 }, { stage: "lost", valueCents: 20000 },
                  ]).map((s: any) => ({ label: s.stage, value: s.valueCents }))}
                  color={brand}
                />
              </Card>
            </LockedCard>
            <LockedCard locked={!has("standard")} planLabel={TIER_LABEL.standard}>
              <Card title="New vs returning customers" subtitle="Invoiced per month">
                <StackedBarChart
                  data={(newVsRet ?? fakeStacked(12)).map((n: any) => ({ label: n.label, newC: n.newCustomers ?? n.newC, returningC: n.returningCustomers ?? n.returningC }))}
                  series={[
                    { key: "newC", label: "New", color: brand },
                    { key: "returningC", label: "Returning", color: "#d2d2d7" },
                  ]}
                />
              </Card>
            </LockedCard>
          </div>
        </div>

        {/* Events */}
        {hasEvents && (
          <div className="space-y-4">
            <Section title="Events" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Margin by event type" subtitle="(Invoiced − cost) ÷ invoiced, per type">
                <RadialRingChart data={marginByType} />
              </Card>
              <Card title="Seasonal booking curve" subtitle="Events by month — where the bulge is is your busy season">
                <RadialTrendChart data={seasonalCurve} />
              </Card>
              <Card title="Bookings by type & status" subtitle="Outer ring: event type · inner ring: status">
                <NestedDonut outer={bookingsByType.outer} inner={bookingsByType.inner} centerLabel="projects" />
              </Card>
              <Card title="Booking lead time" subtitle="Days between project created and event date, by month">
                <RangeBarChart data={leadTimeRange} unit="d" />
              </Card>
              <Card title="Budget vs. actual invoiced" subtitle="One dot per project — above the line means over budget">
                <BudgetScatterChart series={budgetScatter} />
              </Card>
              <Card title="Booking → billing flow" subtitle="Leads through to collected revenue">
                <FlowSankey nodes={billingFlow.nodes} links={billingFlow.links} />
              </Card>
              <Card title="Event performance profile" subtitle="Margin, damage-free rate, reconciliation rate, repeat clients">
                <RadarProfileChart data={perfProfile.data} series={perfProfile.series} />
              </Card>
              <Card title="Sales funnel" subtitle="Lead → Quoted → Confirmed → Completed">
                <FunnelStages data={funnelStages} />
              </Card>
            </div>
          </div>
        )}

        {/* Compliance & Books Health */}
        <div className="space-y-4">
          <Section title="Compliance & Books Health" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="VAT position" subtitle="Net VAT due, monthly">
              <TrendAreaChart data={vatTrend.map((v) => ({ label: v.label, vat: v.netVatDueCents }))} series={[{ key: "vat", label: "Net VAT due", color: brand }]} />
            </Card>
            <Card title="Withholding Tax position" subtitle="WHT claimable deducted by customers">
              <TrendAreaChart data={whtTrend.map((w) => ({ label: w.label, wht: w.whtClaimableCents }))} series={[{ key: "wht", label: "WHT Receivable", color: "#0284c7" }]} />
            </Card>
          </div>

          <Card title="Books health & Accounting Audit" subtitle="General ledger integrity and compliance diagnostics">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <Tile
                label="Ledger balanced"
                value={health.balanced ? "Yes" : "No"}
                tone={health.balanced ? "good" : "bad"}
                sub={health.balanced ? "Zero debit/credit variance" : `Variance: ${fmtKES(health.varianceCents)}`}
              />
              <Tile
                label="Uncategorized bank txns"
                value={String(health.uncategorizedCount)}
                tone={health.uncategorizedCount > 0 ? "warn" : "good"}
                sub={health.uncategorizedCount > 0 ? "Reconciliation required" : "All transactions matched"}
              />
              <Tile
                label="Pending bill approvals"
                value={String(health.pendingBillsCount)}
                tone={health.pendingBillsCount > 0 ? "warn" : undefined}
                sub="Unposted vendor bills"
              />
              <Tile
                label="Open credit notes"
                value={String(health.openCreditsCount)}
                sub="Unapplied customer credits"
              />
              <Tile
                label="Books locked through"
                value={health.lockDate || "Not locked"}
                sub={health.lockDate ? "Prior period sealed" : "Editable historical entries"}
              />
              <Tile
                label="Last reconciliation"
                value={health.lastReconciliationDate || "Never"}
                tone={health.lastReconciliationDate ? undefined : "warn"}
                sub="Bank statement match"
              />
              <Tile
                label="Total ledger entries"
                value={String(health.entriesCount)}
                sub={`Volume: ${fmtKES(health.totalLedgerVolumeCents)}`}
              />
              <Tile
                label="Trial Balance Status"
                value={health.balanced ? "Passed" : "Audit Flag"}
                tone={health.balanced ? "good" : "bad"}
                sub="Automated system check"
              />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
