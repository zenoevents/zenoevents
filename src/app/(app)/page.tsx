import { withOrg, getOrg } from "@/lib/org";
import Link from "next/link";
import { db, documents, todos, events, documentAssignments, recurringTemplates, projects, contacts } from "@/db";
import { desc, asc, inArray, and, eq, exists, isNotNull, ne } from "drizzle-orm";
import { getAccessCached, canViewAllData } from "@/lib/access";
import { dashboardStats, monthlyIncomeExpense, docStatusOverview, memberDashboardStats } from "@/lib/reports";
import { fmtKES, todayISO } from "@/lib/money";
import { PageHeader, StatCard, StatusPill, TableCard, Th, Td } from "@/components/ui";
import { IncomeExpenseChart, TodoWidget, CalendarWidget } from "@/components/DashboardWidgets";
import { DocOverview } from "@/components/DocOverview";
import { TimeTrackingCard } from "@/components/TimeTrackingCard";
import { getActiveShift } from "@/lib/time-tracking";
import { upcomingEventsStrip, unpaidMilestoneRisks, pendingDamageCount, manifestPipelineCounts, projectPipelineCounts, warehouseSummary } from "@/lib/dashboard-events";
import { listMyManifestTasks } from "@/lib/manifests";
import { ThisWeeksEvents, UnpaidMilestoneRisks, OpsSummaryRow, SalesPipelineFunnel } from "@/components/EventsDashboardWidgets";
import { OperationalDashboard } from "@/components/OperationalDashboard";

export const dynamic = "force-dynamic";

const OPERATIONAL_ROLES = new Set(["loading_staff", "collection_staff"]);
const WAREHOUSE_ROLES = new Set(["warehouse_staff"]);

const projectStatusColors: Record<string, string> = {
  lead: "#8a8a8e", quoted: "#2563eb", confirmed: "#7c3aed", in_progress: "#b8860b", completed: "#1f8a4c", cancelled: "#b91c1c",
};
const projectStatusLabels: Record<string, string> = {
  lead: "Lead", quoted: "Quoted", confirmed: "Confirmed", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled",
};

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  return withOrg(async () => {
    const o = await getOrg();
    const today = todayISO();
    const thisYear = today.slice(0, 4);
    const { year: yearParam } = await searchParams;
    const year = /^\d{4}$/.test(yearParam ?? "") ? yearParam! : thisYear;

    const access = await getAccessCached();
    const viewAll = access ? canViewAllData(access) : true;
    const ownOnly = !!access && !viewAll && access.perms.has("dashboard_metrics") && !!access.memberId;
    const isOwnerOrAdmin = !access || access.isOwner || access.role === "admin";

    // Loading/collection/warehouse staff get a task-focused dashboard, not
    // the SME financial one — "today only, nothing else" per the events-
    // vertical brainstorm. Short-circuits before any of the heavier
    // financial queries below even run.
    if (access && OPERATIONAL_ROLES.has(access.role)) {
      const tasks = await listMyManifestTasks();
      return <OperationalDashboard orgName={o?.name ?? "there"} tasks={tasks} />;
    }
    if (access && WAREHOUSE_ROLES.has(access.role)) {
      const [tasks, warehouse] = await Promise.all([listMyManifestTasks(), warehouseSummary()]);
      return <OperationalDashboard orgName={o?.name ?? "there"} tasks={tasks} warehouse={warehouse} />;
    }

    const showEvents = !!access && (isOwnerOrAdmin || access.role === "sales") && access.perms.has("projects");

    const recentDocsWhere = [
      eq(documents.orgId, o.id),
      inArray(documents.type, ["invoice", "bill", "expense"]),
    ];
    if (!viewAll && access?.memberId) {
      recentDocsWhere.push(
        exists(
          db.select().from(documentAssignments).where(
            and(
              eq(documentAssignments.documentId, documents.id),
              eq(documentAssignments.memberId, access.memberId)
            )
          )
        )
      );
    }

    const dueDocsWhere = [
      eq(documents.orgId, o.id),
      inArray(documents.type, ["invoice", "bill"]),
      inArray(documents.status, ["open", "partial"]),
      isNotNull(documents.dueDate),
    ];
    if (!viewAll && access?.memberId) {
      dueDocsWhere.push(
        exists(
          db.select().from(documentAssignments).where(
            and(
              eq(documentAssignments.documentId, documents.id),
              eq(documentAssignments.memberId, access.memberId)
            )
          )
        )
      );
    }

    // All independent — fire in parallel
    const [stats, memberStats, chartData, overview, activeShift, recentDocs, todoRows, eventRows, dueDocs, recurringRows, weekEvents, milestoneRisks, damageCount, manifestCounts, pipelineCounts, calendarProjects] =
      await Promise.all([
        ownOnly ? Promise.resolve(null) : dashboardStats(today),
        ownOnly ? memberDashboardStats(access!.memberId!, today) : Promise.resolve(null),
        ownOnly ? Promise.resolve([]) : monthlyIncomeExpense(6),
        docStatusOverview(year, ownOnly ? access!.memberId! : undefined),
        o.timeTrackingEnabled ? getActiveShift() : Promise.resolve(null),
        db
          .select()
          .from(documents)
          .where(and(...recentDocsWhere))
          .orderBy(desc(documents.createdAt))
          .limit(8),
        db
          .select()
          .from(todos)
          .where(eq(todos.orgId, o.id))
          .orderBy(asc(todos.done), desc(todos.id))
          .limit(30),
        db.select().from(events).where(eq(events.orgId, o.id)),
        db
          .select()
          .from(documents)
          .where(and(...dueDocsWhere)),
        // Recurring templates' next scheduled run.
        viewAll
          ? db.select().from(recurringTemplates).where(and(eq(recurringTemplates.orgId, o.id), eq(recurringTemplates.active, true)))
          : Promise.resolve([]),
        showEvents ? upcomingEventsStrip(7) : Promise.resolve([]),
        showEvents && isOwnerOrAdmin ? unpaidMilestoneRisks(14) : Promise.resolve([]),
        showEvents && isOwnerOrAdmin ? pendingDamageCount() : Promise.resolve(0),
        showEvents && isOwnerOrAdmin ? manifestPipelineCounts() : Promise.resolve({}),
        showEvents && access?.role === "sales" ? projectPipelineCounts() : Promise.resolve({}),
        // Every non-cancelled project's event date, for the calendar — the whole
        // point of an events business is seeing every booked date at a glance.
        showEvents
          ? db
              .select({ id: projects.id, name: projects.name, venue: projects.venue, eventDate: projects.eventDate, status: projects.status, clientName: contacts.displayName })
              .from(projects)
              .leftJoin(contacts, eq(contacts.id, projects.contactId))
              .where(and(eq(projects.orgId, o.id), ne(projects.status, "cancelled")))
          : Promise.resolve([]),
      ]);

    const years = [thisYear, String(Number(thisYear) - 1), String(Number(thisYear) - 2)];

    return (
      <>
        <PageHeader
          title={`Good ${greeting()}, ${o?.name ?? "there"}`}
          subtitle={new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        />

        {showEvents && (
          <div className="space-y-4 mb-6">
            <ThisWeeksEvents events={weekEvents} />
            {isOwnerOrAdmin && <UnpaidMilestoneRisks risks={milestoneRisks} />}
            {isOwnerOrAdmin && <OpsSummaryRow pendingDamage={damageCount} manifestCounts={manifestCounts} />}
            {access?.role === "sales" && <SalesPipelineFunnel counts={pipelineCounts} />}
          </div>
        )}

        {o.timeTrackingEnabled && (
          <TimeTrackingCard
            initialShift={
              activeShift
                ? {
                    id: activeShift.id,
                    clockInAt: activeShift.clockInAt,
                    clockOutAt: activeShift.clockOutAt,
                    durationSeconds: activeShift.durationSeconds,
                  }
                : null
            }
          />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ownOnly && memberStats ? (
            <>
              <StatCard
                label="Your outstanding invoices"
                hint={memberStats.overdueReceivablesCents > 0
                  ? `${fmtKES(memberStats.overdueReceivablesCents)} overdue`
                  : "on documents assigned to you"}
                cents={memberStats.receivablesCents}
                tone={memberStats.overdueReceivablesCents > 0 ? "warn" : "neutral"}
              />
              <StatCard label="Overdue" hint="on your invoices" cents={memberStats.overdueReceivablesCents} tone={memberStats.overdueReceivablesCents > 0 ? "warn" : "good"} />
              {o.showCollectedThisYearCard && (
                <StatCard label="Collected this year" hint="payments on your invoices" cents={memberStats.collectedThisYearCents} tone="good" />
              )}
              <StatCard label="Your bills to pay" hint="assigned bills & expenses" cents={memberStats.payablesCents} />
            </>
          ) : stats ? (
            <>
              <StatCard label="Cash & M-Pesa" hint="across all money accounts" cents={stats.cashCents} />
              <StatCard
                label="Money you're owed"
                hint={stats.overdueReceivablesCents > 0
                  ? `${fmtKES(stats.overdueReceivablesCents)} overdue`
                  : "accounts receivable"}
                cents={stats.receivablesCents}
                tone={stats.overdueReceivablesCents > 0 ? "warn" : "neutral"}
              />
              <StatCard label="Money you owe" hint="accounts payable" cents={stats.payablesCents} />
              <StatCard
                label="VAT due to KRA"
                hint="this month so far"
                cents={stats.netVatDueCents}
                tone={stats.netVatDueCents > 0 ? "warn" : "good"}
              />
            </>
          ) : null}
        </div>

        {/* Calendar — the command center. Full width, up top, so every booked
            event date is visible at a glance before the money breakdown. */}
        <div className="mt-4">
          <CalendarWidget
            maxPerDay={4}
            events={[
              ...calendarProjects.map((p) => ({
                id: `proj-${p.id}`,
                title: p.name,
                date: p.eventDate,
                color: projectStatusColors[p.status] ?? projectStatusColors.lead,
                href: `/projects/${p.id}`,
                subtitle: [p.clientName, p.venue, projectStatusLabels[p.status] ?? p.status].filter(Boolean).join(" · "),
              })),
              ...eventRows.map((e) => ({ id: `evt-${e.id}`, title: e.title, date: e.date, color: "#515154", deletable: true, dbId: e.id })),
              ...dueDocs.map((d) => ({
                id: `doc-${d.id}`,
                title: d.number,
                date: d.dueDate!,
                color: d.type === "invoice" ? "#2563eb" : "#b8860b",
                href: d.type === "invoice" ? `/sales/invoices/${d.id}` : `/purchases/bills/${d.id}`,
              })),
              ...recurringRows.map((r) => ({
                id: `rec-${r.id}`,
                title: r.name,
                date: r.nextRunDate,
                color: "#1f8a4c",
                href: "/recurring",
              })),
            ]}
          />
        </div>

        {/* Invoice & quote overview — yearly money breakdown is admin-only */}
        <div className="mt-4">
          <DocOverview data={overview} year={year} years={years} showBreakdown={viewAll && (isOwnerOrAdmin || o.showInvoiceCollectionTotals)} />
        </div>

        {/* Chart (company-wide, hidden in own-metrics view) + todos */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mt-4 items-stretch">
          {!ownOnly && (
            <div className="lg:col-span-3">
              <IncomeExpenseChart data={chartData} />
            </div>
          )}
          <div className={ownOnly ? "lg:col-span-5" : "lg:col-span-2"}>
            <TodoWidget
              todos={todoRows.map((t) => ({ id: t.id, title: t.title, done: t.done, dueDate: t.dueDate }))}
            />
          </div>
        </div>

        {/* Recent activity */}
        <div className="mt-4">
          <h2 className="text-[15px] font-semibold mb-3">Recent activity</h2>
            {recentDocs.length === 0 ? (
              <div className="card px-6 py-10 text-center text-[13px] text-[var(--color-ink-400)]">
                No transactions yet. Create your first{" "}
                <Link href="/sales/invoices/new" className="text-[var(--color-accent-600)] font-medium">
                  invoice
                </Link>{" "}
                to get going.
              </div>
            ) : (
              <TableCard>
                <thead className="hairline-b">
                  <tr>
                    <Th>Date</Th>
                    <Th>Document</Th>
                    <Th>Status</Th>
                    <Th right>Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {recentDocs.map((d) => (
                    <tr key={d.id} className="hairline-t">
                      <Td className="text-[var(--color-ink-400)]">{d.date}</Td>
                      <Td>
                        <Link href={docHref(d.type, d.id)} className="font-medium hover:text-[var(--color-accent-600)]">
                          {typeLabel(d.type)} {d.number}
                        </Link>
                      </Td>
                      <Td>
                        <StatusPill status={d.status} overdue={isOverdue(d.status, d.dueDate, today)} />
                      </Td>
                      <Td right>{fmtKES(d.totalCents)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableCard>
            )}
        </div>
      </>
    );
  });
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function typeLabel(t: string) {
  return { invoice: "Invoice", bill: "Bill", expense: "Expense", quote: "Quote", credit_note: "Credit note" }[t] ?? t;
}

function docHref(type: string, id: number) {
  if (type === "invoice") return `/sales/invoices/${id}`;
  if (type === "bill") return `/purchases/bills/${id}`;
  return `/purchases/expenses/${id}`;
}

function isOverdue(status: string, dueDate: string | null, today: string) {
  // "partial" invoices/bills are still owed money past due — they must count as
  // overdue too, not just fully-unpaid "open" ones.
  return (status === "open" || status === "partial") && !!dueDate && dueDate < today;
}
