"use server";

import { requirePerm } from "@/lib/guard";
import { getOrg } from "@/lib/org";
import { db, subscriptions, billingPayments } from "@/db";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { intasendStkPush, intasendStatus, intasendCheckout, normalizeKenyanPhone } from "@/lib/payments/intasend";
import { headers } from "next/headers";
import { applyBillingPayment } from "@/lib/billing-apply";

/** Kick off a real IntaSend M-Pesa STK push for the org's own monthly
 *  maintenance fee — self-serve alternative to waiting on an admin. */
export async function initiateSubscriptionPaymentAction(mpesaPhone: string) {
  try {
    await requirePerm("settings");
    const o = await getOrg();

    if (!o.monthlyFeeCents || o.monthlyFeeCents <= 0) return { error: "No maintenance fee has been set for your account yet — contact us." };
    const phone = normalizeKenyanPhone(mpesaPhone);

    const [row] = await db.insert(billingPayments).values({
      orgId: o.id,
      plan: "maintenance",
      cycle: "monthly",
      amountCents: o.monthlyFeeCents,
      phone,
      createdAt: new Date().toISOString(),
    }).returning();

    const { invoiceId, state } = await intasendStkPush({
      amountKes: Math.round(o.monthlyFeeCents / 100),
      phone,
      apiRef: `zeno-sub-${row.id}`,
      narrative: `Zeno maintenance fee — ${o.name}`,
    });

    await db.update(billingPayments)
      .set({ invoiceId, state, updatedAt: new Date().toISOString() })
      .where(eq(billingPayments.id, row.id));

    return { paymentId: row.id };
  } catch (e: any) {
    return { error: e.message || "Could not start the payment — try again" };
  }
}

/** Kick off a card payment via IntaSend hosted checkout — returns a URL to redirect the customer to. */
export async function initiateCardPaymentAction(email: string) {
  try {
    await requirePerm("settings");
    const o = await getOrg();

    if (!o.monthlyFeeCents || o.monthlyFeeCents <= 0) return { error: "No maintenance fee has been set for your account yet — contact us." };
    if (!email || !email.includes("@")) return { error: "Enter a valid email address" };

    const [row] = await db.insert(billingPayments).values({
      orgId: o.id,
      plan: "maintenance",
      cycle: "monthly",
      amountCents: o.monthlyFeeCents,
      method: "card",
      email,
      createdAt: new Date().toISOString(),
    }).returning();

    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") || "https"}://${h.get("host")}`;

    const { id, url } = await intasendCheckout({
      amountKes: Math.round(o.monthlyFeeCents / 100),
      email,
      apiRef: `zeno-sub-${row.id}`,
      comment: `Zeno maintenance fee — ${o.name}`,
      redirectUrl: `${origin}/settings/billing?payment=${row.id}`,
      host: origin,
    });

    await db.update(billingPayments)
      .set({ invoiceId: id, state: "PENDING", updatedAt: new Date().toISOString() })
      .where(eq(billingPayments.id, row.id));

    return { paymentId: row.id, checkoutUrl: url };
  } catch (e: any) {
    return { error: e.message || "Could not start the payment — try again" };
  }
}

/**
 * Poll a pending payment. Returns "complete" once access is extended,
 * "failed" with a reason, or "pending" while the customer is entering their PIN.
 */
export async function checkSubscriptionPaymentAction(paymentId: number) {
  try {
    await requirePerm("settings");
    const o = await getOrg();

    const [p] = await db.select().from(billingPayments)
      .where(and(eq(billingPayments.id, paymentId), eq(billingPayments.orgId, o.id))).limit(1);
    if (!p) return { error: "Payment not found" };
    if (p.state === "applied") return { status: "complete" as const };
    if (p.state === "FAILED") return { status: "failed" as const, reason: p.failedReason || "Payment failed" };
    if (!p.invoiceId) return { error: "Payment was never started" };

    const s = await intasendStatus(p.invoiceId);
    if (s.state === "COMPLETE") {
      await applyBillingPayment(p.id);
      revalidatePath("/", "layout");
      return { status: "complete" as const };
    }
    if (s.state === "FAILED") {
      await db.update(billingPayments)
        .set({ state: "FAILED", failedReason: s.failedReason, updatedAt: new Date().toISOString() })
        .where(eq(billingPayments.id, p.id));
      return { status: "failed" as const, reason: s.failedReason || "Payment failed or was cancelled" };
    }
    return { status: "pending" as const };
  } catch (e: any) {
    return { error: e.message || "Could not check payment status" };
  }
}

/**
 * DEMO ONLY: simulates a successful payment without real money moving.
 * Gate: SIMULATED_BILLING_ENABLED=true, which must stay unset in production.
 */
export async function simulateSubscriptionUpgradeAction() {
  try {
    if (process.env.SIMULATED_BILLING_ENABLED !== "true") {
      return { error: "Simulated billing is disabled." };
    }
    await requirePerm("settings");
    const o = await getOrg();

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const today = new Date();
    today.setDate(today.getDate() + 30);
    const paidUntil = today.toISOString().split("T")[0];

    const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, o.id)).limit(1);
    if (existing) {
      await db.update(subscriptions).set({ paidUntil, status: "active" }).where(eq(subscriptions.orgId, o.id));
    } else {
      await db.insert(subscriptions).values({ orgId: o.id, plan: "manual", paidUntil, status: "active", createdAt: new Date().toISOString() });
    }

    revalidatePath("/", "layout");
    return { success: true };
  } catch (e: any) {
    return { error: e.message || "Failed to extend access" };
  }
}
