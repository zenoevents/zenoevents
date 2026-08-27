import { db, org, subscriptions, manualPayments, billingPayments } from "@/db";
import { eq, sql, gte } from "drizzle-orm";
import Link from "next/link";
import { fmtKES } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function AdminRevenuePage() {
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const thisMonthStart = `${today.slice(0, 7)}-01`;

  const subs = await db
    .select({
      id: subscriptions.id,
      orgId: subscriptions.orgId,
      orgName: org.name,
      orgEmail: org.email,
      monthlyFeeCents: org.monthlyFeeCents,
      paidUntil: subscriptions.paidUntil,
      createdAt: subscriptions.createdAt,
    })
    .from(subscriptions)
    .innerJoin(org, eq(subscriptions.orgId, org.id))
    .orderBy(subscriptions.paidUntil);

  const [manualThisMonth, appliedThisMonth] = await Promise.all([
    db.select({ total: sql<string>`coalesce(sum(${manualPayments.amountCents}), 0)` }).from(manualPayments).where(gte(manualPayments.paidOn, thisMonthStart)),
    db.select({ total: sql<string>`coalesce(sum(${billingPayments.amountCents}), 0)` }).from(billingPayments).where(sql`${billingPayments.state} = 'applied' AND ${billingPayments.updatedAt} >= ${thisMonthStart}`),
  ]);
  const collectedThisMonthCents = Number(manualThisMonth[0]?.total || 0) + Number(appliedThisMonth[0]?.total || 0);

  const active = subs.filter((s) => s.paidUntil >= today && s.monthlyFeeCents > 0);
  const lockedWithFee = subs.filter((s) => s.paidUntil < today && s.monthlyFeeCents > 0);
  const renewingSoon = active.filter((s) => s.paidUntil <= in30);

  const mrrCents = active.reduce((s, r) => s + r.monthlyFeeCents, 0);
  const arrCents = mrrCents * 12;
  const churnRate = active.length + lockedWithFee.length > 0
    ? Math.round((lockedWithFee.length / (active.length + lockedWithFee.length)) * 100)
    : 0;

  const Stat = ({ label, value, sub, subTone }: { label: string; value: string; sub?: string; subTone?: "good" | "bad" | "muted" }) => (
    <div className="bg-white p-5 rounded-xl border border-[var(--color-ink-200)] shadow-sm">
      <div className="text-[12.5px] font-medium text-[var(--color-ink-400)]">{label}</div>
      <div className="text-[26px] font-semibold tracking-tight tnum mt-1.5 leading-none">{value}</div>
      {sub && (
        <div className={`text-[11.5px] mt-2 ${subTone === "good" ? "text-[var(--color-good)]" : subTone === "bad" ? "text-[var(--color-bad)]" : "text-[var(--color-ink-400)]"}`}>{sub}</div>
      )}
    </div>
  );

  const SubTable = ({ rows, empty, dateTone }: { rows: typeof subs; empty: string; dateTone?: "bad" | "warn" }) => (
    <table className="w-full text-left text-[12.5px]">
      <tbody className="divide-y divide-[var(--color-ink-100)] border-t border-[var(--color-ink-100)]">
        {rows.map((s) => (
          <tr key={s.id}>
            <td className="px-5 py-2.5">
              <Link href={`/admin/orgs/${s.orgId}`} className="font-medium text-red-700 hover:underline truncate block max-w-[200px]">
                {s.orgName || `Org #${s.orgId}`}
              </Link>
              <div className="text-[11px] text-[var(--color-ink-400)] truncate max-w-[200px]">{s.orgEmail || "—"}</div>
            </td>
            <td className="px-3 py-2.5 text-right tnum font-medium">{fmtKES(s.monthlyFeeCents)}/mo</td>
            <td className={`px-5 py-2.5 text-right tnum whitespace-nowrap ${dateTone === "bad" ? "text-[var(--color-bad)]" : dateTone === "warn" ? "text-[var(--color-warn)]" : "text-[var(--color-ink-400)]"}`}>
              {s.paidUntil}
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={3} className="px-5 py-8 text-center text-[var(--color-ink-400)]">{empty}</td></tr>
        )}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Revenue</h1>
        <p className="text-[var(--color-ink-500)] text-sm mt-1">Custom maintenance fees across the platform.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="MRR (est.)" value={fmtKES(mrrCents)} sub={`${active.length} active org${active.length === 1 ? "" : "s"} with a fee set`} subTone="muted" />
        <Stat label="ARR (run rate)" value={fmtKES(arrCents)} sub="MRR × 12" subTone="muted" />
        <Stat label="Collected this month" value={fmtKES(collectedThisMonthCents)} sub="manual + self-serve payments" subTone="muted" />
        <Stat label="Renewing in 30 days" value={String(renewingSoon.length)} sub={renewingSoon.length ? "follow up before expiry" : "nothing due"} subTone={renewingSoon.length ? "muted" : "good"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-[var(--color-ink-200)] shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-3">
            <h2 className="text-[13.5px] font-semibold">Upcoming Renewals (30 days)</h2>
          </div>
          <SubTable rows={renewingSoon} empty="No renewals due in the next 30 days." dateTone="warn" />
        </div>
        <div className="bg-white rounded-xl border border-[var(--color-ink-200)] shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-3">
            <h2 className="text-[13.5px] font-semibold">Locked (had a fee, now expired)</h2>
            <p className="text-[11.5px] text-[var(--color-ink-400)] mt-0.5">{churnRate}% of ever-billed orgs</p>
          </div>
          <SubTable rows={lockedWithFee} empty="No churned orgs. 🎉" dateTone="bad" />
        </div>
      </div>
    </div>
  );
}
