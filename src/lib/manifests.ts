"use server";

import { db, manifests, manifestLines, reservations, inventoryItems, items, projects, members } from "@/db";
import { eq, and, ne, asc } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { getAccess } from "@/lib/access";
import { nowISO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { LINE_TRANSITIONS, type LineStatus } from "@/lib/manifest-status";

/** Roles that can act as admin/ops for manifest purposes — everyone else
 *  is restricted to the transitions LINE_TRANSITIONS grants their role. */
async function isManifestAdmin(): Promise<boolean> {
  const access = await getAccess();
  return !!access && (access.isOwner || access.role === "admin");
}

export async function getManifestForProject(projectId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [manifest] = await db.select().from(manifests)
      .where(and(eq(manifests.orgId, orgId), eq(manifests.projectId, projectId))).limit(1);
    if (!manifest) return null;

    const lines = await db
      .select({
        id: manifestLines.id,
        lineType: manifestLines.lineType,
        inventoryItemId: manifestLines.inventoryItemId,
        itemLabel: inventoryItems.label,
        itemName: items.name,
        description: manifestLines.description,
        qtyRequested: manifestLines.qtyRequested,
        qtyUsed: manifestLines.qtyUsed,
        location: manifestLines.location,
        status: manifestLines.status,
        checkedByName: members.name,
        checkedAt: manifestLines.checkedAt,
        notes: manifestLines.notes,
        damageReportId: manifestLines.damageReportId,
      })
      .from(manifestLines)
      .leftJoin(inventoryItems, eq(inventoryItems.id, manifestLines.inventoryItemId))
      .leftJoin(items, eq(items.id, manifestLines.itemId))
      .leftJoin(members, eq(members.id, manifestLines.checkedByMemberId))
      .where(eq(manifestLines.manifestId, manifest.id))
      .orderBy(asc(manifestLines.id));

    return { ...manifest, lines };
  });
}

/** Builds the manifest from the project's currently-booked reservations —
 *  one durable line per reservation. Consumables are added separately
 *  (they're not reservation-backed, there's nothing to conflict-check). */
export async function createManifestAction(projectId: number): Promise<{ success: true; manifestId: number } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [proj] = await db.select({ id: projects.id }).from(projects)
        .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).limit(1);
      if (!proj) throw new Error("Project not found");

      const [existing] = await db.select({ id: manifests.id }).from(manifests)
        .where(and(eq(manifests.orgId, orgId), eq(manifests.projectId, projectId))).limit(1);
      if (existing) throw new Error("This project already has a manifest");

      const activeReservations = await db
        .select({
          inventoryItemId: reservations.inventoryItemId,
          qty: reservations.qty,
          location: reservations.location,
          itemLabel: inventoryItems.label,
          itemName: items.name,
          catalogItemId: inventoryItems.itemId,
        })
        .from(reservations)
        .leftJoin(inventoryItems, eq(inventoryItems.id, reservations.inventoryItemId))
        .leftJoin(items, eq(items.id, inventoryItems.itemId))
        .where(and(eq(reservations.orgId, orgId), eq(reservations.projectId, projectId), ne(reservations.status, "cancelled")));

      const [manifest] = await db.insert(manifests).values({
        orgId, projectId, status: "draft", createdAt: nowISO(),
      }).returning({ id: manifests.id });

      if (activeReservations.length > 0) {
        await db.insert(manifestLines).values(activeReservations.map((r) => ({
          orgId,
          manifestId: manifest.id,
          lineType: "durable" as const,
          inventoryItemId: r.inventoryItemId,
          itemId: r.catalogItemId,
          description: `${r.itemName ?? "Item"} — ${r.itemLabel ?? ""}`.trim(),
          qtyRequested: r.qty,
          location: r.location,
          status: "pending",
          createdAt: nowISO(),
        })));
      }

      await logAudit({ action: "manifest.create", module: "projects", recordId: manifest.id, projectId });
      revalidatePath(`/projects/${projectId}`);
      revalidatePath(`/projects/${projectId}/manifest`);
      return { success: true, manifestId: manifest.id };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not create the manifest" };
  }
}

export async function addConsumableLineAction(manifestId: number, description: string, qtyRequested: number): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [manifest] = await db.select({ id: manifests.id, projectId: manifests.projectId }).from(manifests)
        .where(and(eq(manifests.orgId, orgId), eq(manifests.id, manifestId))).limit(1);
      if (!manifest) throw new Error("Manifest not found");
      if (!description.trim() || !Number.isFinite(qtyRequested) || qtyRequested <= 0) throw new Error("Enter a description and a positive quantity");

      await db.insert(manifestLines).values({
        orgId, manifestId, lineType: "consumable", description: description.trim(),
        qtyRequested, status: "pending", createdAt: nowISO(),
      });
      revalidatePath(`/projects/${manifest.projectId}/manifest`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not add the line" };
  }
}

export async function confirmManifestAction(manifestId: number): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    if (!(await isManifestAdmin())) throw new Error("Only an admin can confirm a manifest");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [manifest] = await db.select().from(manifests)
        .where(and(eq(manifests.orgId, orgId), eq(manifests.id, manifestId))).limit(1);
      if (!manifest) throw new Error("Manifest not found");
      if (manifest.status !== "draft") throw new Error("Only a draft manifest can be confirmed");

      await db.update(manifests).set({ status: "confirmed", confirmedAt: nowISO() }).where(eq(manifests.id, manifestId));
      revalidatePath(`/projects/${manifest.projectId}/manifest`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not confirm the manifest" };
  }
}

/** Advances one line to the next forward status. Gated by LINE_TRANSITIONS —
 *  a loading_staff account can't jump straight to "dispatched" from
 *  "pending", and can't touch a line that isn't theirs to move, unless
 *  they're an admin/owner. */
export async function advanceLineStatusAction(lineId: number, toStatus: LineStatus): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("manifests");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [line] = await db.select().from(manifestLines)
        .where(and(eq(manifestLines.orgId, orgId), eq(manifestLines.id, lineId))).limit(1);
      if (!line) throw new Error("Line not found");

      const allowed = LINE_TRANSITIONS[line.status] ?? [];
      const transition = allowed.find((t) => t.to === toStatus);
      if (!transition) throw new Error(`Can't move from "${line.status}" to "${toStatus}"`);

      const access = await getAccess();
      const isAdmin = !!access && (access.isOwner || access.role === "admin");
      if (!isAdmin && access?.role !== transition.role) {
        throw new Error(`Only ${transition.role.replace("_", " ")} (or an admin) can do this`);
      }

      await db.update(manifestLines).set({
        status: toStatus,
        checkedByMemberId: access?.memberId ?? null,
        checkedAt: nowISO(),
      }).where(eq(manifestLines.id, lineId));

      const [manifest] = await db.select({ id: manifests.id, projectId: manifests.projectId, status: manifests.status }).from(manifests)
        .where(eq(manifests.id, line.manifestId)).limit(1);
      if (manifest && manifest.status === "confirmed") {
        await db.update(manifests).set({ status: "in_progress" }).where(eq(manifests.id, manifest.id));
      }

      await logAudit({ action: "manifest_line.advance", module: "projects", recordId: lineId, detail: toStatus, projectId: manifest?.projectId ?? null });
      if (manifest) revalidatePath(`/projects/${manifest.projectId}/manifest`);
      revalidatePath("/manifests");
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not update this line" };
  }
}

/** Inspection outcomes that don't need a damage report (good / needs
 *  cleaning). Damaged/missing go through damage-reports.ts's
 *  createDamageReportAction(manifestLineId: ...) instead — photo required,
 *  same as any other damage report — which sets the line's terminal status
 *  itself once the report is filed. */
export async function inspectLineAction(lineId: number, outcome: "good" | "needs_cleaning", notes?: string): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("manifests");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [line] = await db.select().from(manifestLines)
        .where(and(eq(manifestLines.orgId, orgId), eq(manifestLines.id, lineId))).limit(1);
      if (!line) throw new Error("Line not found");
      if (line.status !== "returned") throw new Error("Only a returned line can be inspected");

      const access = await getAccess();
      const isAdmin = !!access && (access.isOwner || access.role === "admin");
      if (!isAdmin && access?.role !== "warehouse_staff") throw new Error("Only warehouse staff (or an admin) can inspect returns");

      await db.update(manifestLines).set({
        status: outcome === "good" ? "inspected_good" : "inspected_needs_cleaning",
        notes: notes || line.notes,
        checkedByMemberId: access?.memberId ?? null,
        checkedAt: nowISO(),
      }).where(eq(manifestLines.id, lineId));

      const [manifest] = await db.select({ projectId: manifests.projectId }).from(manifests).where(eq(manifests.id, line.manifestId)).limit(1);
      if (manifest) revalidatePath(`/projects/${manifest.projectId}/manifest`);
      revalidatePath("/manifests");
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not inspect this line" };
  }
}

export async function reconcileManifestAction(manifestId: number): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    if (!(await isManifestAdmin())) throw new Error("Only an admin can reconcile a manifest");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [manifest] = await db.select().from(manifests)
        .where(and(eq(manifests.orgId, orgId), eq(manifests.id, manifestId))).limit(1);
      if (!manifest) throw new Error("Manifest not found");

      const lines = await db.select({ lineType: manifestLines.lineType, status: manifestLines.status })
        .from(manifestLines).where(eq(manifestLines.manifestId, manifestId));
      const unresolvedDurable = lines.find((l) => l.lineType === "durable" && !l.status.startsWith("inspected_"));
      if (unresolvedDurable) throw new Error("Every durable line needs to be inspected before reconciling");

      await db.update(manifests).set({ status: "reconciled", reconciledAt: nowISO() }).where(eq(manifests.id, manifestId));
      await logAudit({ action: "manifest.reconcile", module: "projects", recordId: manifestId, projectId: manifest.projectId });
      revalidatePath(`/projects/${manifest.projectId}/manifest`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not reconcile the manifest" };
  }
}

/** Cross-project "my tasks today" — every line whose current status is one
 *  this viewer's role can act on, regardless of which project it's under.
 *  Admin sees everything actionable across all roles. */
export async function listMyManifestTasks() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const access = await getAccess();
    const isAdmin = !!access && (access.isOwner || access.role === "admin");

    const rows = await db
      .select({
        lineId: manifestLines.id,
        status: manifestLines.status,
        description: manifestLines.description,
        qtyRequested: manifestLines.qtyRequested,
        manifestId: manifestLines.manifestId,
        projectId: manifests.projectId,
        projectName: projects.name,
        eventDate: projects.eventDate,
      })
      .from(manifestLines)
      .innerJoin(manifests, eq(manifests.id, manifestLines.manifestId))
      .innerJoin(projects, eq(projects.id, manifests.projectId))
      .where(and(eq(manifestLines.orgId, orgId), ne(manifests.status, "reconciled")))
      .orderBy(asc(projects.eventDate));

    if (isAdmin) return rows;

    const actionableStatuses = new Set<string>();
    if (access?.role === "warehouse_staff") { actionableStatuses.add("pending"); actionableStatuses.add("returned"); }
    if (access?.role === "loading_staff") { actionableStatuses.add("picked"); actionableStatuses.add("loaded"); }
    if (access?.role === "collection_staff") { actionableStatuses.add("dispatched"); actionableStatuses.add("collected"); }

    return rows.filter((r) => actionableStatuses.has(r.status));
  });
}
