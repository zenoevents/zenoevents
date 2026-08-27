"use server";

import { db, projects, contacts, paymentSchedule, documents, damageReports, manifests, manifestLines, items, stockLots, inventoryItems } from "@/db";
import { eq, and, gte, lte, ne, sql, asc, desc, inArray } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { todayISO } from "@/lib/money";
import { lineFloorStage } from "@/lib/manifest-status";

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

    // Manifest readiness per project — one batched join instead of N+1, for
    // the mini progress bar on each event card.
    const manifestRows = await db
      .select({ projectId: manifests.projectId, lineStatus: manifestLines.status })
      .from(manifests)
      .innerJoin(manifestLines, eq(manifestLines.manifestId, manifests.id))
      .where(and(eq(manifests.orgId, orgId), inArray(manifests.projectId, projectIds), eq(manifestLines.lineType, "durable")));

    const readinessByProject = new Map<number, { picked: number; total: number }>();
    for (const r of manifestRows) {
      const entry = readinessByProject.get(r.projectId) ?? { picked: 0, total: 0 };
      entry.total += 1;
      if (r.lineStatus !== "pending") entry.picked += 1;
      readinessByProject.set(r.projectId, entry);
    }

    return rows.map((r) => ({
      ...r,
      depositStatus: firstByProject.get(r.id) ?? "none",
      readiness: readinessByProject.get(r.id) ?? null,
    }));
  });
}

/** Live (non-reconciled) manifests bucketed into the 7-stage pipeline the
 *  home dashboard shows — a count per stage, "where's the bottleneck." */
export async function manifestPipelineStageCounts() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const liveManifests = await db
      .select({ id: manifests.id, status: manifests.status })
      .from(manifests)
      .where(and(eq(manifests.orgId, orgId), ne(manifests.status, "reconciled")));

    const counts: Record<string, number> = { draft: 0, confirmed: 0, packing: 0, loaded: 0, dispatched: 0, returned: 0, inspected: 0 };
    if (liveManifests.length === 0) return counts;

    const inProgress = liveManifests.filter((m) => m.status === "in_progress");
    for (const m of liveManifests) {
      if (m.status === "draft") counts.draft += 1;
      else if (m.status === "confirmed") counts.confirmed += 1;
    }

    if (inProgress.length > 0) {
      const lines = await db
        .select({ manifestId: manifestLines.manifestId, status: manifestLines.status })
        .from(manifestLines)
        .where(and(eq(manifestLines.orgId, orgId), inArray(manifestLines.manifestId, inProgress.map((m) => m.id)), eq(manifestLines.lineType, "durable")));

      const linesByManifest = new Map<number, string[]>();
      for (const l of lines) {
        const arr = linesByManifest.get(l.manifestId) ?? [];
        arr.push(l.status);
        linesByManifest.set(l.manifestId, arr);
      }

      const order = ["packing", "loaded", "dispatched", "returned", "inspected"] as const;
      for (const m of inProgress) {
        const statuses = linesByManifest.get(m.id) ?? [];
        if (statuses.length === 0) { counts.packing += 1; continue; }
        const stages = statuses.map(lineFloorStage);
        const floor = order.find((s) => stages.includes(s)) ?? "packing";
        counts[floor] += 1;
      }
    }

    return counts;
  });
}

/** Recent unresolved damage reports, with photo path, for the dashboard
 *  thumbnail feed — the whole point of the photo-evidence trust mechanism
 *  is wasted as a bare count, so this surfaces the evidence directly. */
export async function pendingDamageReportsFeed(limit = 3) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select({
        id: damageReports.id,
        projectId: damageReports.projectId,
        projectName: projects.name,
        itemName: items.name,
        damageType: damageReports.damageType,
        photoUrl: damageReports.photoUrl,
        createdAt: damageReports.createdAt,
      })
      .from(damageReports)
      .leftJoin(projects, eq(projects.id, damageReports.projectId))
      .leftJoin(inventoryItems, eq(inventoryItems.id, damageReports.inventoryItemId))
      .leftJoin(items, eq(items.id, inventoryItems.itemId))
      .where(and(eq(damageReports.orgId, orgId), eq(damageReports.liabilityStatus, "pending")))
      .orderBy(desc(damageReports.createdAt))
      .limit(limit);
  });
}

/** Lines inspected as "needs cleaning" with no further action ever
 *  available in the UI today (confirmed against LINE_TRANSITIONS/
 *  inspectLineAction) — a real gap this surfaces for the first time. */
export async function stuckCleaningItems() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select({
        id: manifestLines.id,
        description: manifestLines.description,
        projectId: manifests.projectId,
        projectName: projects.name,
        checkedAt: manifestLines.checkedAt,
      })
      .from(manifestLines)
      .innerJoin(manifests, eq(manifests.id, manifestLines.manifestId))
      .innerJoin(projects, eq(projects.id, manifests.projectId))
      .where(and(eq(manifestLines.orgId, orgId), eq(manifestLines.status, "inspected_needs_cleaning")))
      .orderBy(asc(manifestLines.checkedAt));
  });
}

/** Stocked goods (kind=goods, trackInventory) whose remaining stock has
 *  fallen under their own reorderLevel — that field has had no consumer
 *  anywhere in the app until now. */
export async function lowStockItems() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const rows = await db
      .select({
        id: items.id,
        name: items.name,
        reorderLevel: items.reorderLevel,
        remaining: sql<number>`coalesce(sum(${stockLots.remainingQty}), 0)`,
      })
      .from(items)
      .leftJoin(stockLots, and(eq(stockLots.orgId, items.orgId), eq(stockLots.itemId, items.id)))
      .where(and(eq(items.orgId, orgId), eq(items.kind, "goods"), eq(items.trackInventory, true), eq(items.archived, false), sql`${items.reorderLevel} > 0`))
      .groupBy(items.id, items.name, items.reorderLevel)
      .having(sql`coalesce(sum(${stockLots.remainingQty}), 0) < ${items.reorderLevel}`);
    return rows;
  });
}

/** Durable manifest lines not yet dispatched whose project's event date is
 *  within the window — the forward-looking "what needs to move in the next
 *  24-48h" view, distinct from the pipeline bar's current-state snapshot. */
export async function upcomingManifestDeadlines(hours = 48) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const today = todayISO();
    const until = new Date(Date.now() + hours * 3600000).toISOString().slice(0, 10);

    return db
      .select({
        lineId: manifestLines.id,
        description: manifestLines.description,
        status: manifestLines.status,
        projectId: projects.id,
        projectName: projects.name,
        eventDate: projects.eventDate,
      })
      .from(manifestLines)
      .innerJoin(manifests, eq(manifests.id, manifestLines.manifestId))
      .innerJoin(projects, eq(projects.id, manifests.projectId))
      .where(and(
        eq(manifestLines.orgId, orgId),
        eq(manifestLines.lineType, "durable"),
        inArray(manifestLines.status, ["pending", "picked", "loaded"]),
        gte(projects.eventDate, today),
        lte(projects.eventDate, until),
        ne(projects.status, "cancelled"),
      ))
      .orderBy(asc(projects.eventDate));
  });
}

/** Non-cancelled projects grouped by event month — the income-chart
 *  overlay, zipped by index against reports.ts's monthlyIncomeExpense
 *  (same month-key convention: YYYY-MM, last N months). */
export async function monthlyEventCounts(months = 6): Promise<number[]> {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const rows = await db
      .select({ month: sql<string>`substr(${projects.eventDate}, 1, 7)`, count: sql<number>`count(*)`.mapWith(Number) })
      .from(projects)
      .where(and(eq(projects.orgId, orgId), ne(projects.status, "cancelled")))
      .groupBy(sql`substr(${projects.eventDate}, 1, 7)`);

    const byMonth = new Map(rows.map((r) => [r.month, r.count]));
    const now = new Date();
    const out: number[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      out.push(byMonth.get(key) ?? 0);
    }
    return out;
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
