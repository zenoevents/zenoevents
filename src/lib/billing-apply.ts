import { db, billingPayments, subscriptions } from "@/db";
import { eq } from "drizzle-orm";

/**
 * Activate/extend access from a COMPLETE billing payment — extends
 * subscriptions.paidUntil by 30 days (from today, or from the existing
 * paidUntil if access hasn't lapsed yet). Idempotent: flips the payment
 * row to "applied" and only acts on the first call — safe to invoke from
 * both the status poll and the webhook.
 */
export async function applyBillingPayment(paymentId: number): Promise<boolean> {
  const [p] = await db.select().from(billingPayments).where(eq(billingPayments.id, paymentId)).limit(1);
  if (!p || p.state === "applied") return false;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, p.orgId)).limit(1);

  // Paying before access has lapsed extends from the current paidUntil;
  // paying after a lockout starts the new 30 days from today.
  const base = existing && existing.paidUntil > today ? new Date(existing.paidUntil) : now;
  base.setDate(base.getDate() + 30);
  const paidUntil = base.toISOString().slice(0, 10);

  if (existing) {
    await db.update(subscriptions)
      .set({ paidUntil, status: "active" })
      .where(eq(subscriptions.id, existing.id));
  } else {
    await db.insert(subscriptions).values({
      orgId: p.orgId,
      plan: "manual",
      paidUntil,
      status: "active",
      createdAt: new Date().toISOString(),
    });
  }

  await db.update(billingPayments)
    .set({ state: "applied", updatedAt: new Date().toISOString() })
    .where(eq(billingPayments.id, paymentId));
  return true;
}
