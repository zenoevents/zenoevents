"use server";

import { db, paymentSchedule, projects, documents, org } from "@/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { nowISO, todayISO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { upsertDocumentAction } from "@/lib/actions";
import { revalidatePath } from "next/cache";
import { milestoneAmountCents } from "@/lib/milestone-amount";

/** Milestone template + (once generated) the real invoice it produced. */
export async function listPaymentSchedule(projectId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select({
        id: paymentSchedule.id,
        milestoneName: paymentSchedule.milestoneName,
        triggerType: paymentSchedule.triggerType,
        triggerValue: paymentSchedule.triggerValue,
        amountType: paymentSchedule.amountType,
        percentageValue: paymentSchedule.percentageValue,
        fixedAmountCents: paymentSchedule.fixedAmountCents,
        sequenceOrder: paymentSchedule.sequenceOrder,
        documentId: paymentSchedule.documentId,
        docNumber: documents.number,
        docStatus: documents.status,
        docTotalCents: documents.totalCents,
        docPaidCents: documents.paidCents,
      })
      .from(paymentSchedule)
      .leftJoin(documents, eq(documents.id, paymentSchedule.documentId))
      .where(and(eq(paymentSchedule.orgId, orgId), eq(paymentSchedule.projectId, projectId)))
      .orderBy(asc(paymentSchedule.sequenceOrder), asc(paymentSchedule.id));
  });
}

export async function addMilestoneAction(projectId: number, formData: FormData) {
  await requirePerm("projects");
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [proj] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).limit(1);
    if (!proj) throw new Error("Project not found");

    const milestoneName = (formData.get("milestoneName") as string)?.trim();
    const triggerType = formData.get("triggerType") as string;
    const triggerValue = (formData.get("triggerValue") as string) || null;
    const amountType = formData.get("amountType") as string;
    const percentageValue = amountType === "percentage" ? parseFloat((formData.get("percentageValue") as string) || "0") : null;
    const fixedAmountCents = amountType === "fixed" ? Math.round(parseFloat((formData.get("fixedAmount") as string) || "0") * 100) : null;

    if (!milestoneName || !triggerType || !amountType) throw new Error("Milestone name, trigger, and amount type are required");
    if (amountType === "percentage" && (!percentageValue || percentageValue <= 0)) throw new Error("Enter a percentage greater than 0");
    if (amountType === "fixed" && (!fixedAmountCents || fixedAmountCents <= 0)) throw new Error("Enter a fixed amount greater than 0");

    const [{ count }] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(paymentSchedule).where(eq(paymentSchedule.projectId, projectId));

    await db.insert(paymentSchedule).values({
      orgId, projectId, milestoneName, triggerType, triggerValue,
      amountType, percentageValue, fixedAmountCents,
      sequenceOrder: count,
      createdAt: nowISO(),
    });

    await logAudit({ action: "payment_schedule.create", module: "projects", recordLabel: milestoneName, projectId });
    revalidatePath(`/projects/${projectId}`);
    return { success: true };
  });
}

export async function deleteMilestoneAction(id: number) {
  await requirePerm("projects");
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [row] = await db.select().from(paymentSchedule)
      .where(and(eq(paymentSchedule.orgId, orgId), eq(paymentSchedule.id, id))).limit(1);
    if (!row) throw new Error("Milestone not found");
    if (row.documentId) throw new Error("Can't delete a milestone that already has an invoice — void the invoice instead");
    await db.delete(paymentSchedule).where(eq(paymentSchedule.id, id));
    revalidatePath(`/projects/${row.projectId}`);
    return { success: true };
  });
}

/**
 * Generates the real invoice for one milestone — a normal `documents` row
 * (type invoice, projectId set) built through the existing invoice engine
 * (saveDocument + issueDocument), not a parallel one. Reused everywhere an
 * invoice already works: PDF, Paystack/M-Pesa collection, the Invoices list.
 */
export async function generateInvoiceForMilestoneAction(id: number) {
  await requirePerm("projects");
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [row] = await db
      .select({
        id: paymentSchedule.id,
        projectId: paymentSchedule.projectId,
        milestoneName: paymentSchedule.milestoneName,
        amountType: paymentSchedule.amountType,
        percentageValue: paymentSchedule.percentageValue,
        fixedAmountCents: paymentSchedule.fixedAmountCents,
        documentId: paymentSchedule.documentId,
      })
      .from(paymentSchedule)
      .where(and(eq(paymentSchedule.orgId, orgId), eq(paymentSchedule.id, id)))
      .limit(1);
    if (!row) throw new Error("Milestone not found");
    if (row.documentId) throw new Error("This milestone already has an invoice");

    const [proj] = await db.select({ id: projects.id, name: projects.name, contactId: projects.contactId, budgetCents: projects.budgetCents })
      .from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, row.projectId))).limit(1);
    if (!proj) throw new Error("Project not found");
    if (!proj.contactId) throw new Error("Assign a client to this project before generating invoices");

    const amountCents = milestoneAmountCents(row, proj.budgetCents);
    if (amountCents <= 0) throw new Error("This milestone computes to zero — check the project budget or the milestone's percentage/amount");

    const [orgRow] = await db.select({ vatRegistered: org.vatRegistered }).from(org).where(eq(org.id, orgId)).limit(1);

    const result = await upsertDocumentAction({
      type: "invoice",
      contactId: proj.contactId,
      date: todayISO(),
      taxInclusive: false,
      notes: `${proj.name} — ${row.milestoneName}`,
      lines: [{
        description: `${row.milestoneName} — ${proj.name}`,
        qty: 1,
        unitPriceCents: amountCents,
        discountPct: 0,
        taxClass: orgRow?.vatRegistered ? "B16" : "D_NONVAT",
      }],
      issue: true,
    });
    if (result.error || !result.id) throw new Error(result.error || "Couldn't create the invoice");

    await db.update(documents).set({ projectId: row.projectId }).where(eq(documents.id, result.id));
    await db.update(paymentSchedule).set({ documentId: result.id }).where(eq(paymentSchedule.id, id));

    await logAudit({ action: "payment_schedule.invoice", module: "projects", recordId: result.id, detail: row.milestoneName, projectId: row.projectId });
    revalidatePath(`/projects/${row.projectId}`);
    revalidatePath("/sales/invoices");
    return { success: true, documentId: result.id };
  });
}
