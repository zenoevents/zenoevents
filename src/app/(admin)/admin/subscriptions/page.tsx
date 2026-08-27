export const dynamic = "force-dynamic";

import { db, subscriptions, org } from "@/db";
import { eq, desc } from "drizzle-orm";
import { resolveAccess } from "@/lib/billing";

export default async function AdminSubscriptionsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const subs = await db
    .select({
      id: subscriptions.id,
      orgId: subscriptions.orgId,
      orgName: org.name,
      paidUntil: subscriptions.paidUntil,
      createdAt: subscriptions.createdAt,
    })
    .from(subscriptions)
    .leftJoin(org, eq(subscriptions.orgId, org.id))
    .orderBy(desc(subscriptions.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
        <p className="text-[var(--color-ink-500)] text-sm mt-1">All tenant subscription records.</p>
      </div>

      <div className="bg-white rounded-xl border border-[var(--color-ink-200)] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[var(--color-ink-50)] border-b border-[var(--color-ink-200)] text-[13px] text-[var(--color-ink-600)] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-medium">Org</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Access Until</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-ink-100)]">
              {subs.map((s) => {
                const status = resolveAccess(s.paidUntil, today).status;
                return (
                  <tr key={s.id} className="hover:bg-[var(--color-ink-50)] transition-colors">
                  <td className="px-4 py-3 font-medium">{s.orgName || `Org #${s.orgId}`}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      status === "active" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                    }`}>
                      {status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-ink-500)]">{s.paidUntil}</td>
                  <td className="px-4 py-3 text-[var(--color-ink-500)]">{s.createdAt.slice(0, 10)}</td>
                  </tr>
                );
              })}
              {subs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[var(--color-ink-500)]">
                    No subscriptions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
