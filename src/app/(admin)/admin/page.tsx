import { db, org, members, subscriptions, paymentEvents, manualPayments, billingPayments } from "@/db";
import { sql, eq, count, desc, gte } from "drizzle-orm";
import { fmtKES } from "@/lib/money";
import { resolveAccess } from "@/lib/billing";
import { SignupsChart, PlanDonut, MpesaVolumeChart } from "@/components/AdminCharts";
import Link from "next/link";

export const dynamic = "force-dynamic";

function monthKeys(n: number): { key: string; label: string }[] {
  const now = new Date();
  const out: { key: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-KE", { month: "short" }),
    });
  }
  return out;
}

export default async function AdminDashboard() {
  const months = monthKeys(6);
  const thisMonthKey = months[months.length - 1].key;
  const today = new Date().toISOString().slice(0, 10);

  const [
    [orgCount],
    [userCount],
    allSubs,
    [mpesaStats],
    [mpesaFailed],
    signupRows,
    mpesaMonthly,
    recentOrgs,
    recentEvents,
    activeFeeOrgs,
    [manualThisMonth],
    [appliedThisMonth],
  ] = await Promise.all([
    db.select({ count: count() }).from(org),
    db.select({ count: count() }).from(members),
    db.select({ orgId: subscriptions.orgId, paidUntil: subscriptions.paidUntil }).from(subscriptions),
    db.select({ totalVolume: sql<string>`coalesce(sum(${paymentEvents.amountCents}), 0)`, count: count() }).from(paymentEvents).where(eq(paymentEvents.gatewayId, "mpesa_daraja")),
    db.select({ count: count() }).from(paymentEvents).where(sql`${paymentEvents.gatewayId} = 'mpesa_daraja' AND ${paymentEvents.status} IN ('failed', 'unmatched', 'amount_mismatch')`),
    // Org signups per month — signup date comes from the owner's auth.users row
    db.execute(sql`
      select substr(u.created_at::text, 1, 7) as month, count(*)::int as signups
      from org o join auth.users u on u.id::text = o.user_id
      group by 1
    `),
    db.execute(sql`
      select substr(created_at, 1, 7) as month,
             coalesce(sum(amount_cents), 0)::bigint as volume,
             count(*) filter (where status in ('failed','unmatched','amount_mismatch'))::int as failed
      from payment_events
      group by 1
    `),
    db.execute(sql`
      select o.id, o.name, o.email, substr(u.created_at::text, 1, 10) as joined,
             case when s.paid_until >= ${today} then 'active' else 'locked' end as status
      from org o
      join auth.users u on u.id::text = o.user_id
      left join subscriptions s on s.org_id = o.id
      order by u.created_at desc
      limit 6
    `),
    db.select({
      id: paymentEvents.id,
      amountCents: paymentEvents.amountCents,
      status: paymentEvents.status,
      payerName: paymentEvents.payerName,
      createdAt: paymentEvents.createdAt,
      orgName: org.name,
    }).from(paymentEvents).leftJoin(org, eq(paymentEvents.orgId, org.id)).orderBy(desc(paymentEvents.createdAt)).limit(6),
    // Orgs currently active — their monthlyFeeCents sums to an estimated MRR.
    db.select({ monthlyFeeCents: org.monthlyFeeCents }).from(org).innerJoin(subscriptions, eq(subscriptions.orgId, org.id)).where(gte(subscriptions.paidUntil, today)),
    db.select({ total: sql<string>`coalesce(sum(${manualPayments.amountCents}), 0)` }).from(manualPayments).where(gte(manualPayments.paidOn, `${thisMonthKey}-01`)),
    db.select({ total: sql<string>`coalesce(sum(${billingPayments.amountCents}), 0)` }).from(billingPayments).where(sql`${billingPayments.state} = 'applied' AND ${billingPayments.updatedAt} >= ${`${thisMonthKey}-01`}`),
  ]);

  const signupsByMonth = new Map((signupRows as unknown as { month: string; signups: number }[]).map((r) => [r.month, Number(r.signups)]));
  const signupSeries = months.map((m) => ({ label: m.label, signups: signupsByMonth.get(m.key) || 0 }));
  const signupsThisMonth = signupsByMonth.get(thisMonthKey) || 0;

  const mpesaByMonth = new Map((mpesaMonthly as unknown as { month: string; volume: string; failed: number }[]).map((r) => [r.month, r]));
  const mpesaSeries = months.map((m) => {
    const r = mpesaByMonth.get(m.key);
    return { label: m.label, volumeCents: Number(r?.volume || 0), failed: Number(r?.failed || 0) };
  });

  const activeCount = allSubs.filter((s) => resolveAccess(s.paidUntil, today).status === "active").length;
  const lockedCount = Math.max(0, orgCount.count - activeCount);
  const accessData = [
    { plan: "active", label: "Active", count: activeCount },
    { plan: "locked", label: "Locked", count: lockedCount },
  ];

  const mrrCents = activeFeeOrgs.reduce((s, o) => s + (o.monthlyFeeCents || 0), 0);
  const revenueThisMonthCents = Number(manualThisMonth.total || 0) + Number(appliedThisMonth.total || 0);

  const failRate = mpesaStats.count ? Math.round((mpesaFailed.count / mpesaStats.count) * 100) : 0;

  const statusBadge: Record<string, string> = {
    applied: "bg-emerald-50 text-emerald-700 border-emerald-200",
    matched: "bg-emerald-50 text-emerald-700 border-emerald-200",
    received: "bg-sky-50 text-sky-700 border-sky-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    failed: "bg-red-50 text-red-700 border-red-200",
    unmatched: "bg-red-50 text-red-700 border-red-200",
    amount_mismatch: "bg-red-50 text-red-700 border-red-200",
  };
  const accessBadge: Record<string, string> = {
    active: "bg-[var(--color-accent-50)] text-[var(--color-accent-700)] border-[var(--color-accent-100)]",
    locked: "bg-red-50 text-red-700 border-red-200",
  };

  const Stat = ({ label, value, sub, subTone }: { label: string; value: string; sub?: string; subTone?: "good" | "bad" | "muted" }) => (
    <div className="bg-white p-5 rounded-xl border border-[var(--color-ink-200)] shadow-sm">
      <div className="text-[12.5px] font-medium text-[var(--color-ink-400)]">{label}</div>
      <div className="text-[26px] font-semibold tracking-tight tnum mt-1.5 leading-none">{value}</div>
      {sub && (
        <div className={`text-[11.5px] mt-2 ${subTone === "good" ? "text-[var(--color-good)]" : subTone === "bad" ? "text-[var(--color-bad)]" : "text-[var(--color-ink-400)]"}`}>
          {sub}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform Overview</h1>
          <p className="text-[var(--color-ink-500)] text-sm mt-1">Key metrics across all tenants.</p>
        </div>
        <div className="text-[11.5px] text-[var(--color-ink-400)] shrink-0 pb-1">
          {new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Organizations" value={String(orgCount.count)} sub={signupsThisMonth > 0 ? `+${signupsThisMonth} this month` : "No new signups this month"} subTone={signupsThisMonth > 0 ? "good" : "muted"} />
        <Stat label="Staff Users" value={String(userCount.count)} sub="across all tenants" subTone="muted" />
        <Stat label="Active Organizations" value={String(activeCount)} sub={`${lockedCount} locked`} subTone="muted" />
        <Stat label="MRR (est.)" value={fmtKES(mrrCents)} sub={`${fmtKES(revenueThisMonthCents)} collected this month`} subTone="muted" />
      </div>

      {/* Growth + plan mix */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 bg-white rounded-xl border border-[var(--color-ink-200)] shadow-sm p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[13.5px] font-semibold">Organization Signups</h2>
            <span className="text-[11.5px] text-[var(--color-ink-400)]">last 6 months</span>
          </div>
          <SignupsChart data={signupSeries} />
        </div>
        <div className="lg:col-span-2 bg-white rounded-xl border border-[var(--color-ink-200)] shadow-sm p-5">
          <h2 className="text-[13.5px] font-semibold mb-4">Access Mix</h2>
          <PlanDonut data={accessData} />
        </div>
      </div>

      {/* M-Pesa */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 bg-white rounded-xl border border-[var(--color-ink-200)] shadow-sm p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[13.5px] font-semibold">M-Pesa Volume (Daraja)</h2>
            <span className="text-[11.5px] text-[var(--color-ink-400)]">last 6 months</span>
          </div>
          <MpesaVolumeChart data={mpesaSeries} />
        </div>
        <div className="lg:col-span-2 grid grid-rows-3 gap-4">
          <Stat label="Total Volume Processed" value={fmtKES(Number(mpesaStats.totalVolume || 0))} />
          <Stat label="Payment Events" value={String(mpesaStats.count)} sub="all time" subTone="muted" />
          <Stat label="Failed / Unmatched" value={String(mpesaFailed.count)} sub={mpesaStats.count ? `${failRate}% of events` : "no events yet"} subTone={mpesaFailed.count > 0 ? "bad" : "good"} />
        </div>
      </div>

      {/* Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-[var(--color-ink-200)] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <h2 className="text-[13.5px] font-semibold">Recent Signups</h2>
            <Link href="/admin/orgs" className="text-[11.5px] font-medium text-red-700 hover:underline">View all</Link>
          </div>
          <table className="w-full text-left text-[12.5px]">
            <tbody className="divide-y divide-[var(--color-ink-100)] border-t border-[var(--color-ink-100)]">
              {(recentOrgs as unknown as { id: number; name: string; email: string | null; joined: string; status: string }[]).map((o) => (
                <tr key={o.id}>
                  <td className="px-5 py-2.5">
                    <div className="font-medium truncate max-w-[180px]">{o.name || <span className="text-[var(--color-ink-400)] italic">Not onboarded</span>}</div>
                    <div className="text-[11px] text-[var(--color-ink-400)] truncate max-w-[180px]">{o.email || "—"}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-medium border capitalize ${accessBadge[o.status] || accessBadge.locked}`}>{o.status}</span>
                  </td>
                  <td className="px-5 py-2.5 text-right text-[var(--color-ink-400)] tnum whitespace-nowrap">{o.joined}</td>
                </tr>
              ))}
              {(recentOrgs as unknown as unknown[]).length === 0 && (
                <tr><td className="px-5 py-8 text-center text-[var(--color-ink-400)]">No organizations yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl border border-[var(--color-ink-200)] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <h2 className="text-[13.5px] font-semibold">Recent Payment Events</h2>
            <Link href="/admin/payments" className="text-[11.5px] font-medium text-red-700 hover:underline">View all</Link>
          </div>
          <table className="w-full text-left text-[12.5px]">
            <tbody className="divide-y divide-[var(--color-ink-100)] border-t border-[var(--color-ink-100)]">
              {recentEvents.map((e) => (
                <tr key={e.id}>
                  <td className="px-5 py-2.5">
                    <div className="font-medium truncate max-w-[160px]">{e.payerName || "Unknown payer"}</div>
                    <div className="text-[11px] text-[var(--color-ink-400)] truncate max-w-[160px]">{e.orgName || "—"}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-medium border capitalize ${statusBadge[e.status] || "bg-[var(--color-ink-50)] text-[var(--color-ink-600)] border-[var(--color-ink-200)]"}`}>
                      {e.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-right font-medium tnum whitespace-nowrap">{fmtKES(e.amountCents)}</td>
                </tr>
              ))}
              {recentEvents.length === 0 && (
                <tr><td className="px-5 py-8 text-center text-[var(--color-ink-400)]">No payment events yet. They&apos;ll appear once M-Pesa Daraja goes live.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
