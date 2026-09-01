import { getClientSession } from "@/lib/client-portal/auth";
import { db, documents } from "@/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
import { StatusPill, TableCard, Th, Td } from "@/components/ui";
import { fmtKES } from "@/lib/money";
import { getClientPaymentsTrend, getClientDashboardStats } from "@/lib/client-portal/projects";
import { TrendAreaChart } from "@/components/analytics/Charts";

export const dynamic = "force-dynamic";

function StatIcon({ name }: { name: "invoice" | "quote" | "balance" | "activity" | "project" | "calendar" }) {
  const paths: Record<string, React.ReactNode> = {
    invoice: <><path d="M6 2h9l3 3v17H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    quote: <><path d="M7 8h10M7 12h10M7 16h6" /><rect x="3" y="4" width="18" height="16" rx="2" /></>,
    balance: <><path d="M12 2v20M17 5H9.5a2.5 2.5 0 0 0 0 5H14a2.5 2.5 0 0 1 0 5H7" /></>,
    activity: <><polyline points="3 12 8 12 10 18 14 6 16 12 21 12" /></>,
    project: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /><circle cx="12" cy="15" r="2" /></>,
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export default async function ClientPortalDashboard({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const session = await getClientSession(orgSlug);
  if (!session) redirect(`/portal/${orgSlug}/login`);

  const [recentDocs, trend, stats] = await Promise.all([
    db.select().from(documents).where(and(
      eq(documents.orgId, session.orgId), eq(documents.contactId, session.contactId), inArray(documents.type, ["invoice", "quote"]),
    )).orderBy(desc(documents.date), desc(documents.id)).limit(5),
    getClientPaymentsTrend(session.orgId, session.contactId, 6),
    getClientDashboardStats(session.orgId, session.contactId),
  ]);

  const unpaidInvoices = recentDocs.filter((d) => d.type === "invoice" && ["open", "partial"].includes(d.status));
  const collectionPct = stats.totalInvoicedCents > 0 ? Math.round((stats.totalCollectedCents / stats.totalInvoicedCents) * 100) : 0;
  const daysToNextEvent = stats.nextEvent
    ? Math.ceil((new Date(stats.nextEvent.eventDate).getTime() - Date.now()) / 86_400_000)
    : null;

  const kpis = [
    { label: "Active projects", value: String(stats.activeProjectCount), icon: "project" as const, tone: "neutral" as const },
    { label: "Unpaid invoices", value: String(stats.unpaidCount), icon: "invoice" as const, tone: stats.unpaidCount > 0 ? "warn" as const : "good" as const },
    { label: "Outstanding balance", value: fmtKES(stats.outstandingCents), icon: "balance" as const, tone: stats.outstandingCents > 0 ? "warn" as const : "good" as const },
    { label: "Events in 30 days", value: String(stats.eventsIn30Days), icon: "calendar" as const, tone: "neutral" as const },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="text-3xl font-bold text-[var(--color-ink-900)] tracking-tight">Client Dashboard</h1>
        <Link
          href={`/portal/${orgSlug}/documents`}
          className="px-4 py-2.5 bg-[var(--color-ink-900)] text-white text-[13px] font-semibold rounded-full hover:bg-black transition-colors"
        >
          View all documents
        </Link>
      </div>

      {/* Hero: payments trend chart + collection-progress spotlight + next event */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2 p-6">
          <div className="text-[12.5px] font-semibold text-[var(--color-ink-600)] mb-1">Payments received</div>
          <div className="text-[11px] text-[var(--color-ink-400)] mb-3">Last 6 months, across every project</div>
          <TrendAreaChart data={trend.map((t) => ({ label: t.label, collected: t.collected }))} series={[{ key: "collected", label: "Collected", color: "#0f766e" }]} height={220} />
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-3xl p-6 bg-[var(--color-ink-900)] text-white flex flex-col justify-between shadow-lg flex-1">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 mb-2">Overall</p>
              <h4 className="text-[17px] font-bold tracking-tight">Payment collection</h4>
            </div>
            <div className="mt-8">
              <div className="flex justify-between items-end mb-2">
                <span className="text-3xl font-semibold tracking-tighter tnum">{collectionPct}%</span>
                <span className="text-[11px] font-medium text-white/50 mb-1">{fmtKES(stats.totalCollectedCents)} of {fmtKES(stats.totalInvoicedCents)}</span>
              </div>
              <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${Math.min(100, collectionPct)}%` }} />
              </div>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-ink-50)] flex items-center justify-center border border-[var(--color-ink-100)] shrink-0 text-[var(--color-ink-600)]">
                <StatIcon name="calendar" />
              </div>
              <h4 className="font-bold text-[13.5px] text-[var(--color-ink-900)]">Next event</h4>
            </div>
            {stats.nextEvent ? (
              <p className="text-[12.5px] text-[var(--color-ink-500)]">
                <span className="text-[var(--color-ink-900)] font-semibold">{stats.nextEvent.name}</span> in{" "}
                <span className="text-[var(--color-ink-900)] font-semibold">{daysToNextEvent}</span> day{daysToNextEvent === 1 ? "" : "s"} &middot; {stats.nextEvent.eventDate}
              </p>
            ) : (
              <p className="text-[12.5px] text-[var(--color-ink-500)]">Nothing on the calendar right now.</p>
            )}
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className={`p-5 rounded-2xl border bg-[var(--color-ink-50)] border-[var(--color-ink-100)] transition-colors ${
              k.tone === "good" ? "hover:border-emerald-300 hover:bg-emerald-50" : k.tone === "warn" ? "hover:border-amber-300 hover:bg-amber-50" : "hover:border-[var(--color-ink-200)]"
            }`}
          >
            <div className="w-9 h-9 rounded-full bg-white text-[var(--color-ink-600)] flex items-center justify-center border border-[var(--color-ink-100)] mb-3">
              <StatIcon name={k.icon} />
            </div>
            <p className="text-[11px] font-bold text-[var(--color-ink-400)] uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-[19px] font-black text-[var(--color-ink-900)] tracking-tight tnum">{k.value}</p>
          </div>
        ))}
      </div>

      {unpaidInvoices.length > 0 && (
        <div className="card p-5">
          <div className="text-[13px] font-semibold text-[var(--color-ink-600)] mb-3">Action needed — invoices awaiting payment</div>
          <div className="space-y-3">
            {unpaidInvoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between p-3 bg-red-50/50 border border-red-100 rounded-2xl">
                <div>
                  <div className="font-medium text-[13.5px] text-[var(--color-ink-900)]">{inv.number}</div>
                  <div className="text-[12.5px] text-[var(--color-ink-500)] mt-0.5">Due {inv.dueDate} &middot; {fmtKES(inv.totalCents - inv.paidCents)}</div>
                </div>
                <Link href={`/portal/${orgSlug}/documents`} className="px-4 py-1.5 bg-[var(--color-brand)] text-white text-[12.5px] font-semibold rounded-full shadow-sm hover:opacity-90">
                  Pay Now
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex justify-between items-end mb-4">
          <h2 className="text-[16px] font-bold text-[var(--color-ink-900)]">Recent Documents</h2>
          <Link href={`/portal/${orgSlug}/documents`} className="text-[13px] text-[var(--color-brand)] font-medium hover:underline">
            View all &rarr;
          </Link>
        </div>
        <TableCard>
          <thead className="hairline-b">
            <tr>
              <Th>Date</Th>
              <Th>Number</Th>
              <Th>Status</Th>
              <Th right>Total</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {recentDocs.map((d) => (
              <tr key={d.id} className="hairline-t">
                <Td className="text-[var(--color-ink-500)]">{d.date}</Td>
                <Td className="font-medium capitalize">{d.type} {d.number}</Td>
                <Td><StatusPill status={d.status} /></Td>
                <Td right>{fmtKES(d.totalCents)}</Td>
                <Td right>
                  <div className="flex justify-end gap-2">
                    <a
                      href={`/portal/${orgSlug}/api/pdf/${d.id}`}
                      target="_blank"
                      className="px-3 py-1 border border-[var(--color-ink-200)] text-[12px] font-medium text-[var(--color-ink-700)] rounded-md hover:bg-[var(--color-ink-50)] transition-all"
                    >
                      View PDF
                    </a>
                    <a
                      href={`/portal/${orgSlug}/api/pdf/${d.id}?download=1`}
                      className="px-3 py-1 bg-[var(--color-ink-900)] text-white text-[12px] font-medium rounded-md hover:bg-black transition-all"
                    >
                      Download
                    </a>
                  </div>
                </Td>
              </tr>
            ))}
            {recentDocs.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-10 text-[13px] text-[var(--color-ink-400)]">
                  No documents found.
                </td>
              </tr>
            )}
          </tbody>
        </TableCard>
      </div>
    </div>
  );
}
