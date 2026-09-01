import { db, projects, reservations, inventoryItems, documents, manifests } from "@/db";
import { eq, and, inArray, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/project-status";

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
