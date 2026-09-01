"use server";

import { db, documents, paymentGateways, paymentEvents, contacts } from "@/db";
import { eq, and } from "drizzle-orm";
import { getClientSession } from "@/lib/client-portal/auth";
import { getGateway } from "@/lib/payments/gateway";
import { advanceProjectStatus } from "@/lib/project-status-advance";
import { revalidatePath } from "next/cache";

export async function portalRequestPaymentAction(slug: string, documentId: number, phone: string) {
  const session = await getClientSession(slug);
  if (!session) return { error: "Not authenticated" };

  const [doc] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.orgId, session.orgId), eq(documents.contactId, session.contactId)));
  if (!doc) return { error: "Document not found" };
  if (doc.type !== "invoice") return { error: "Can only pay invoices" };

  const amountCents = doc.totalCents - doc.paidCents;
  if (amountCents <= 0) return { error: "Invoice is already paid" };

  // Pick the first enabled gateway (preferably Daraja)
  const [gwConfig] = await db.select().from(paymentGateways).where(and(
    eq(paymentGateways.orgId, session.orgId),
    eq(paymentGateways.enabled, true)
  )).limit(1);

  if (!gwConfig) return { error: "No payment gateway configured for this business." };

  if (!doc.contactId) return { error: "Document has no contact" };

  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, doc.contactId), eq(contacts.orgId, session.orgId)));

  const gateway = getGateway(gwConfig);

  try {
    const result = await gateway.requestPayment({
      phone,
      amountCents,
      accountRef: doc.number,
      description: `Payment for Invoice ${doc.number}`,
      payerName: contact?.displayName || contact?.companyName || undefined,
      payerEmail: contact?.email || undefined,
    });

    await db.insert(paymentEvents).values({
      orgId: session.orgId,
      gatewayId: gwConfig.gatewayId,
      providerRef: result.providerRef,
      amountCents,
      payerPhone: phone,
      accountRef: doc.number,
      status: "pending",
      matchedDocumentId: documentId,
      rawJson: JSON.stringify({ stkPushRef: result.providerRef, phone, amountCents }),
      createdAt: new Date().toISOString(),
    }).onConflictDoNothing({ target: [paymentEvents.gatewayId, paymentEvents.providerRef] });

    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Failed to initiate payment." };
  }
}

/** Client-side "Accept" on a sent quote — mirrors the staff-side markQuote
 *  action exactly (same status value, same downstream project-status
 *  advance to "confirmed"), just re-derived from the portal session instead
 *  of trusting a client-supplied orgId/contactId. */
export async function portalAcceptQuoteAction(slug: string, documentId: number): Promise<{ success: true } | { error: string }> {
  const session = await getClientSession(slug);
  if (!session) return { error: "Not authenticated" };

  const [doc] = await db.select().from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.orgId, session.orgId), eq(documents.contactId, session.contactId)));
  if (!doc) return { error: "Quote not found" };
  if (doc.type !== "quote") return { error: "Only quotes can be accepted" };
  if (doc.status !== "open") return { error: "This quote isn't awaiting a response" };

  await db.update(documents).set({ status: "accepted" }).where(eq(documents.id, doc.id));
  if (doc.projectId) {
    await advanceProjectStatus(session.orgId, doc.projectId, "confirmed", "quote accepted (client portal)");
  }
  revalidatePath(`/portal/${slug}/documents`);
  if (doc.projectId) revalidatePath(`/portal/${slug}/projects/${doc.projectId}`);
  return { success: true };
}

export async function portalDeclineQuoteAction(slug: string, documentId: number): Promise<{ success: true } | { error: string }> {
  const session = await getClientSession(slug);
  if (!session) return { error: "Not authenticated" };

  const [doc] = await db.select().from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.orgId, session.orgId), eq(documents.contactId, session.contactId)));
  if (!doc) return { error: "Quote not found" };
  if (doc.type !== "quote") return { error: "Only quotes can be declined" };
  if (doc.status !== "open") return { error: "This quote isn't awaiting a response" };

  await db.update(documents).set({ status: "declined" }).where(eq(documents.id, doc.id));
  revalidatePath(`/portal/${slug}/documents`);
  if (doc.projectId) revalidatePath(`/portal/${slug}/projects/${doc.projectId}`);
  return { success: true };
}
