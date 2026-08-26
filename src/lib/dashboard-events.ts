"use server";

import { db, projects, contacts, paymentSchedule, documents, damageReports, manifests, manifestLines } from "@/db";
import { eq, and, gte, lte, ne, sql, asc, inArray } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { todayISO } from "@/lib/money";

/** Every project with an event date in [today, today+days] — the command-
 *  center strip. depositStatus is the earliest milestone's invoice status,
 *  "none" if no schedule has been set up yet at all. */
export async function upcomingEventsStrip(days = 7) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const today = todayISO();
    const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        venue: projects.venue,
        eventDate: projects.eventDate,
        status: projects.status,
        clientName: contacts.displayName,
      })
      .from(projects)
      .leftJoin(contacts, eq(contacts.id, projects.contactId))
      .where(and(eq(projects.orgId, orgId), gte(projects.eventDate, today), lte(projects.eventDate, until), ne(projects.status, "cancelled")))
      .orderBy(asc(projects.eventDate));

    if (rows.length === 0) return [];

    const projectIds = rows.map((r) => r.id);
    const schedules = await db
      .select({
        projectId: paymentSchedule.projectId,
        sequenceOrder: paymentSchedule.sequenceOrder,
        docStatus: documents.status,
      })
      .from(paymentSchedule)
      .leftJoin(documents, eq(documents.id, paymentSchedule.documentId))
      .where(and(eq(paymentSchedule.orgId, orgId), inArray(paymentSchedule.projectId, projectIds)))
      .orderBy(asc(paymentSchedule.sequenceOrder));

    const firstByProject = new Map<number, string | null>();
    for (const s of schedules) {
      if (!firstByProject.has(s.projectId)) firstByProject.set(s.projectId, s.docStatus ?? "unbilled");
    }

    return rows.map((r) => ({
      ...r,
      depositStatus: firstByProject.get(r.id) ?? "none",
    }));
  });
}

/** Milestone invoices still unpaid with the event date closing in — the
 *  risk flag: should ops release inventory/staff for an unpaid event? */
export async function unpaidMilestoneRisks(days = 14) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const today = todayISO();
    const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

    return db
      .select({
        projectId: projects.id,
        projectName: projects.name,
        eventDate: projects.eventDate,
        milestoneName: paymentSchedule.milestoneName,
        docStatus: documents.status,
        docTotalCents: documents.totalCents,
        docPaidCents: documents.paidCents,
      })
      .from(paymentSchedule)
      .innerJoin(documents, eq(documents.id, paymentSchedule.documentId))
      .innerJoin(projects, eq(projects.id, paymentSchedule.projectId))
      .where(and(
        eq(paymentSchedule.orgId, orgId),
        inArray(documents.status, ["open", "partial"]),
        gte(projects.eventDate, today),
        lte(projects.eventDate, until),
        ne(projects.status, "cancelled"),
      ))
      .orderBy(asc(projects.eventDate));
  });
}

export async function pendingDamageCount(): Promise<number> {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [row] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(damageReports).where(and(eq(damageReports.orgId, orgId), eq(damageReports.liabilityStatus, "pending")));
    return row?.count ?? 0;
  });
}

/** Projects grouped by status — the sales pipeline funnel. */
export async function projectPipelineCounts() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const rows = await db.select({ status: projects.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(projects).where(eq(projects.orgId, orgId)).groupBy(projects.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.count]));
  });
}

/** Manifests grouped by status — "what's stuck where" at a glance. */
export async function manifestPipelineCounts() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const rows = await db.select({ status: manifests.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(manifests).where(eq(manifests.orgId, orgId)).groupBy(manifests.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.count]));
  });
}

/** Warehouse-facing counts: lines waiting to be picked, and lines back but
 *  not yet inspected — the two things blocking restock/dispatch. */
export async function warehouseSummary() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const rows = await db
      .select({ status: manifestLines.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(manifestLines)
      .innerJoin(manifests, eq(manifests.id, manifestLines.manifestId))
      .where(and(eq(manifestLines.orgId, orgId), ne(manifests.status, "reconciled"), inArray(manifestLines.status, ["pending", "returned"])))
      .groupBy(manifestLines.status);
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));
    return { pendingPick: byStatus.pending ?? 0, awaitingInspection: byStatus.returned ?? 0 };
  });
}
