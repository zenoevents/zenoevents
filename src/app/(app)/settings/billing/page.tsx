import { requirePerm } from "@/lib/guard";
import { getOrg } from "@/lib/org";
import { db, subscriptions, manualPayments, billingPayments } from "@/db";
import { eq, and, desc } from "drizzle-orm";
import { resolveAccess } from "@/lib/billing";
import { PageHeader } from "@/components/ui";
import { BillingClient } from "./ClientPage";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  await requirePerm("settings");
  const o = await getOrg();

  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, o.id)).limit(1);
  const access = resolveAccess(sub?.paidUntil ?? new Date().toISOString().slice(0, 10));

  const [manual, applied] = await Promise.all([
    db.select().from(manualPayments).where(eq(manualPayments.orgId, o.id)).orderBy(desc(manualPayments.paidOn)),
    db.select().from(billingPayments).where(and(eq(billingPayments.orgId, o.id), eq(billingPayments.state, "applied"))).orderBy(desc(billingPayments.createdAt)),
  ]);

  const history = [
    ...manual.map((m) => ({ id: `manual-${m.id}`, date: m.paidOn, amountCents: m.amountCents, kind: m.kind, source: m.method || "Recorded by admin" })),
    ...applied.map((p) => ({ id: `pay-${p.id}`, date: p.createdAt.slice(0, 10), amountCents: p.amountCents, kind: "maintenance" as const, source: p.method === "card" ? "Card (Pay now)" : "M-Pesa (Pay now)" })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <>
      <PageHeader title="Billing" subtitle="Your account status and payment history." />
      <div className="mt-8">
        <BillingClient
          status={access.status}
          paidUntil={access.paidUntil}
          oneTimeFeeCents={o.oneTimeFeeCents}
          monthlyFeeCents={o.monthlyFeeCents}
          history={history}
          orgPhone={o.phone || ""}
          orgEmail={o.email || ""}
        />
      </div>
    </>
  );
}
