import { db, projects, reservations, inventoryItems, documents, documentLines, manifests } from "@/db";
import { eq, and, inArray, notInArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { nowISO } from "@/lib/money";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/project-status";

/** Same overlap check as inventory-instances.ts's checkReservationConflict —
 *  duplicated in-line rather than imported, since that file (via saveItem)
 *  chains back into actions.ts, which imports this module: importing it back
 *  would close a 3-way circular "use server" import. */
async function hasReservationConflict(orgId: number, inventoryItemId: number, startDate: string, endDate: string): Promise<boolean> {
  const [row] = await db.select({ id: reservations.id }).from(reservations)
    .where(and(
      eq(reservations.orgId, orgId),
      eq(reservations.inventoryItemId, inventoryItemId),
      ne(reservations.status, "cancelled"),
      sql`${reservations.startDate} <= ${endDate}`,
      sql`${reservations.endDate} >= ${startDate}`,
    )).limit(1);
  return !!row;
}

/**
 * Confirming a project from its real invoice content — not a suggestion,
 * an actual booking — but only where it's unambiguous: a line's item auto-
 * books only when it maps to exactly one Event Inventory batch (same
 * conservative rule the warehouse auto-fill already uses), there's enough
 * free qty in that batch, and the date doesn't conflict with another
 * project's booking. Anything ambiguous, short, or conflicting is skipped
 * silently — staff sorts it out manually via the Reserve Inventory panel;
 * this never blocks the project from confirming.
 *
 * Includes draft invoices, not just issued ones — a quote converted to
 * invoice is deliberately left as an unissued draft for staff to review
 * (see the "quote converted to invoice" trigger), but its line items are
 * still real committed content the moment the project is confirmed, not
 * hypothetical. Only "void" is excluded.
 */
async function autoBookReservationsFromInvoices(orgId: number, projectId: number): Promise<number> {
  const [project] = await db.select({ eventDate: projects.eventDate }).from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).limit(1);
  if (!project) return 0;

  const lines = await db.select({ itemId: documentLines.itemId, qty: documentLines.qty })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(
      eq(documents.orgId, orgId),
      eq(documents.projectId, projectId),
      eq(documents.type, "invoice"),
      ne(documents.status, "void"),
    ));

  const qtyByItem = new Map<number, number>();
  for (const l of lines) {
    if (!l.itemId) continue;
    qtyByItem.set(l.itemId, (qtyByItem.get(l.itemId) ?? 0) + l.qty);
  }
  if (qtyByItem.size === 0) return 0;

  const batches = await db.select({ id: inventoryItems.id, itemId: inventoryItems.itemId, qty: inventoryItems.qty, status: inventoryItems.status })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.orgId, orgId), inArray(inventoryItems.itemId, [...qtyByItem.keys()])));

  const batchesByItem = new Map<number, typeof batches>();
  for (const b of batches) {
    const arr = batchesByItem.get(b.itemId) ?? [];
    arr.push(b);
    batchesByItem.set(b.itemId, arr);
  }

  const existing = await db.select({ inventoryItemId: reservations.inventoryItemId }).from(reservations)
    .where(and(eq(reservations.orgId, orgId), eq(reservations.projectId, projectId), ne(reservations.status, "cancelled")));
  const alreadyReservedIds = new Set(existing.map((r) => r.inventoryItemId));

  let bookedCount = 0;
  for (const [itemId, qty] of qtyByItem) {
    const itemBatches = batchesByItem.get(itemId);
    if (!itemBatches || itemBatches.length !== 1) continue;
    const batch = itemBatches[0];
    if (alreadyReservedIds.has(batch.id)) continue;
    if (batch.qty < qty) continue;

    const conflict = await hasReservationConflict(orgId, batch.id, project.eventDate, project.eventDate);
    if (conflict) continue;

    await db.insert(reservations).values({
      orgId,
      inventoryItemId: batch.id,
      projectId,
      qty,
      startDate: project.eventDate,
      endDate: project.eventDate,
      status: "booked",
      createdAt: nowISO(),
    });
    if (batch.status === "in_store") {
      await db.update(inventoryItems).set({ status: "reserved" }).where(eq(inventoryItems.id, batch.id));
    }
    bookedCount++;
  }
  return bookedCount;
}

/**
 * Moves a project's status forward automatically when a real lifecycle event
 * happens elsewhere (a quote is sent, a quote is accepted, an invoice is
 * issued) — never backward, never touching a cancelled or already-further-
 * along project. A plain (non "use server") module so both actions.ts and
 * projects.ts can call it without a circular "use server" import between
 * them. Reuses the same reservation-promotion side effect the manual
 * updateProjectStatusAction already applies when moving into "confirmed".
 */
export async function advanceProjectStatus(orgId: number, projectId: number, target: ProjectStatus, reason: string) {
  const [row] = await db.select({ status: projects.status }).from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).limit(1);
  if (!row) return;
  if (row.status === "cancelled") return;

  const currentIdx = PROJECT_STATUSES.indexOf(row.status as ProjectStatus);
  const targetIdx = PROJECT_STATUSES.indexOf(target);
  if (targetIdx <= currentIdx) return;

  await db.update(projects).set({ status: target }).where(eq(projects.id, projectId));

  let promotedCount = 0;
  if (target === "confirmed") {
    const quoted = await db.select({ id: reservations.id, inventoryItemId: reservations.inventoryItemId })
      .from(reservations)
      .where(and(eq(reservations.orgId, orgId), eq(reservations.projectId, projectId), eq(reservations.status, "quoted")));
    if (quoted.length > 0) {
      await db.update(reservations).set({ status: "booked" })
        .where(inArray(reservations.id, quoted.map((r) => r.id)));
      const itemIds = [...new Set(quoted.map((r) => r.inventoryItemId))];
      await db.update(inventoryItems).set({ status: "reserved" }).where(and(
        eq(inventoryItems.orgId, orgId),
        inArray(inventoryItems.id, itemIds),
        eq(inventoryItems.status, "in_store"),
      ));
      promotedCount = quoted.length;
    }
  }

  await logAudit({
    action: "project.status",
    module: "projects",
    recordId: projectId,
    detail: promotedCount > 0 ? `${target} (auto: ${reason}, +${promotedCount} reservations booked)` : `${target} (auto: ${reason})`,
    projectId,
  });
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects/inventory");

  // Auto-booking runs on every call, not just the one that flips the
  // status — advanceProjectStatus() no-ops for a project already at/past
  // "confirmed", so a second invoice (or an edit adding lines to an
  // existing one) needs its own pass to pick up newly-added items.
  await maybeAutoBookProjectItems(orgId, projectId);
}

/**
 * Runs the invoice-item auto-book pass for a project that's already firm
 * (confirmed/in_progress/completed) — safe to call after every invoice
 * save/issue/edit for a project, whether or not that particular call is
 * what confirmed it. Silently does nothing for a project that isn't firm
 * yet (booking before confirmation would be premature — that's what the
 * separate "quoted" reservation status is for).
 */
export async function maybeAutoBookProjectItems(orgId: number, projectId: number) {
  const [row] = await db.select({ status: projects.status }).from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).limit(1);
  if (!row || !["confirmed", "in_progress", "completed"].includes(row.status)) return;

  const bookedCount = await autoBookReservationsFromInvoices(orgId, projectId);
  if (bookedCount > 0) {
    await logAudit({
      action: "project.status",
      module: "projects",
      recordId: projectId,
      detail: `+${bookedCount} items auto-booked from invoice`,
      projectId,
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/projects/inventory");
  }
}

/**
 * Completion needs BOTH signals, not just one — a fully-paid invoice with
 * gear still out, or a reconciled manifest with money still owed, isn't
 * actually done. Called from both the payment-recording side (postPayment/
 * postCreditNote) and the manifest side (reconcileManifestAction); whichever
 * one fires second is the one that actually flips the project.
 *
 * A side with nothing to check (no real invoices yet, or no manifest at all
 * — plenty of projects never reserve inventory) is treated as satisfied on
 * its own, so it never permanently blocks completion on a mechanism the
 * project doesn't use.
 */
export async function maybeCompleteProject(orgId: number, projectId: number, reason: string) {
  const realInvoices = await db.select({ status: documents.status }).from(documents)
    .where(and(
      eq(documents.orgId, orgId),
      eq(documents.projectId, projectId),
      eq(documents.type, "invoice"),
      notInArray(documents.status, ["draft", "void"]),
    ));
  const invoicesSettled = realInvoices.length === 0 || realInvoices.every((d) => d.status === "paid");

  const [manifest] = await db.select({ status: manifests.status }).from(manifests)
    .where(and(eq(manifests.orgId, orgId), eq(manifests.projectId, projectId))).limit(1);
  const manifestSettled = !manifest || manifest.status === "reconciled";

  if (invoicesSettled && manifestSettled) {
    await advanceProjectStatus(orgId, projectId, "completed", reason);
  }
}
