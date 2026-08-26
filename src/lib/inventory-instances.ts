"use server";

import { db, inventoryItems, reservations, items, projects, warehouses } from "@/db";
import { eq, and, ne, sql, inArray } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { nowISO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import type { InventoryStatus } from "@/lib/inventory-status";

/** Durable, rentable inventory instances/batches — chairs, tents, AV gear —
 *  distinct from the FIFO consumable stock in stockLots (src/lib/inventory.ts). */
export async function listInventoryInstances() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select({
        id: inventoryItems.id,
        label: inventoryItems.label,
        qty: inventoryItems.qty,
        condition: inventoryItems.condition,
        status: inventoryItems.status,
        itemId: inventoryItems.itemId,
        itemName: items.name,
        warehouseId: inventoryItems.warehouseId,
        warehouseName: warehouses.name,
      })
      .from(inventoryItems)
      .leftJoin(items, eq(items.id, inventoryItems.itemId))
      .leftJoin(warehouses, eq(warehouses.id, inventoryItems.warehouseId))
      .where(eq(inventoryItems.orgId, orgId))
      .orderBy(items.name, inventoryItems.label);
  });
}

export async function listCatalogItems() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db.select({ id: items.id, name: items.name })
      .from(items)
      .where(and(eq(items.orgId, orgId), eq(items.archived, false)))
      .orderBy(items.name);
  });
}

export async function createInventoryInstanceAction(formData: FormData) {
  await requirePerm("projects");
  return withOrg(async () => {
    const orgId = currentOrgId();
    const itemId = parseInt(formData.get("itemId") as string, 10);
    const label = (formData.get("label") as string)?.trim();
    const qty = parseFloat((formData.get("qty") as string) || "1");
    const warehouseIdRaw = formData.get("warehouseId") as string;
    const warehouseId = warehouseIdRaw ? parseInt(warehouseIdRaw, 10) : null;

    if (!itemId || !label || !Number.isFinite(qty) || qty <= 0) {
      throw new Error("Item, label, and a positive quantity are required");
    }

    await db.insert(inventoryItems).values({
      orgId, itemId, label, qty, warehouseId,
      condition: "good",
      status: "in_store",
      createdAt: nowISO(),
    });

    await logAudit({ action: "inventory_item.create", module: "projects", recordLabel: label });
    revalidatePath("/projects/inventory");
    return { success: true };
  });
}

export async function updateInventoryStatusAction(id: number, status: InventoryStatus) {
  await requirePerm("projects");
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [row] = await db.select({ id: inventoryItems.id }).from(inventoryItems)
      .where(and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.id, id))).limit(1);
    if (!row) throw new Error("Inventory item not found");
    await db.update(inventoryItems).set({ status }).where(eq(inventoryItems.id, id));
    await logAudit({ action: "inventory_item.status", module: "projects", recordId: id, detail: status });
    revalidatePath("/projects/inventory");
    return { success: true };
  });
}

/** Reservations currently booked for this inventory item, for display. */
export async function listReservationsForItem(inventoryItemId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select({
        id: reservations.id,
        projectId: reservations.projectId,
        projectName: projects.name,
        qty: reservations.qty,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
        status: reservations.status,
      })
      .from(reservations)
      .leftJoin(projects, eq(projects.id, reservations.projectId))
      .where(and(eq(reservations.orgId, orgId), eq(reservations.inventoryItemId, inventoryItemId)))
      .orderBy(reservations.startDate);
  });
}

export async function listReservationsForProject(projectId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select({
        id: reservations.id,
        inventoryItemId: reservations.inventoryItemId,
        label: inventoryItems.label,
        itemName: items.name,
        qty: reservations.qty,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
        location: reservations.location,
        status: reservations.status,
      })
      .from(reservations)
      .leftJoin(inventoryItems, eq(inventoryItems.id, reservations.inventoryItemId))
      .leftJoin(items, eq(items.id, inventoryItems.itemId))
      .where(and(eq(reservations.orgId, orgId), eq(reservations.projectId, projectId)))
      .orderBy(reservations.startDate);
  });
}

/**
 * The conflict-check surface: any other active reservation for this item
 * whose [startDate, endDate] range overlaps the requested one. Two ranges
 * overlap iff each starts before the other ends — the classic interval-
 * overlap test, done as plain string comparison since dates are stored
 * ISO-formatted (lexicographic order = chronological order).
 */
export async function checkReservationConflict(
  inventoryItemId: number,
  startDate: string,
  endDate: string,
  excludeReservationId?: number
) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const conditions = [
      eq(reservations.orgId, orgId),
      eq(reservations.inventoryItemId, inventoryItemId),
      ne(reservations.status, "cancelled"),
      sql`${reservations.startDate} <= ${endDate}`,
      sql`${reservations.endDate} >= ${startDate}`,
    ];
    if (excludeReservationId) conditions.push(ne(reservations.id, excludeReservationId));

    const rows = await db
      .select({
        id: reservations.id,
        projectId: reservations.projectId,
        projectName: projects.name,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
      })
      .from(reservations)
      .leftJoin(projects, eq(projects.id, reservations.projectId))
      .where(and(...conditions));

    return rows;
  });
}

/**
 * Books an inventory item to a project across a date range. Runs the
 * conflict check first — by default this throws on overlap (a hard warning
 * at booking time is the whole point), pass force:true to let an admin book
 * anyway (e.g. the "conflicting" reservation is actually being replaced).
 */
export async function createReservationAction(params: {
  projectId: number;
  inventoryItemId: number;
  qty: number;
  startDate: string;
  endDate: string;
  location?: string | null;
  force?: boolean;
}) {
  await requirePerm("projects");
  return withOrg(async () => {
    const orgId = currentOrgId();
    if (params.startDate > params.endDate) throw new Error("Start date must be before end date");

    const conflicts = await checkReservationConflict(params.inventoryItemId, params.startDate, params.endDate);
    if (conflicts.length > 0 && !params.force) {
      return {
        conflict: true,
        conflicts: conflicts.map((c) => ({ projectName: c.projectName, startDate: c.startDate, endDate: c.endDate })),
      };
    }

    await db.insert(reservations).values({
      orgId,
      inventoryItemId: params.inventoryItemId,
      projectId: params.projectId,
      qty: params.qty,
      startDate: params.startDate,
      endDate: params.endDate,
      location: params.location?.trim() || null,
      status: "booked",
      createdAt: nowISO(),
    });

    await db.update(inventoryItems).set({ status: "reserved" }).where(and(
      eq(inventoryItems.orgId, orgId),
      eq(inventoryItems.id, params.inventoryItemId),
      eq(inventoryItems.status, "in_store"),
    ));

    await logAudit({ action: "reservation.create", module: "projects", recordId: params.projectId });
    revalidatePath(`/projects/${params.projectId}`);
    revalidatePath("/projects/inventory");
    return { success: true };
  });
}

export async function cancelReservationAction(id: number) {
  await requirePerm("projects");
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [row] = await db.select().from(reservations)
      .where(and(eq(reservations.orgId, orgId), eq(reservations.id, id))).limit(1);
    if (!row) throw new Error("Reservation not found");
    await db.update(reservations).set({ status: "cancelled" }).where(eq(reservations.id, id));

    // If nothing else has this item reserved/dispatched, it's free again.
    const [stillActive] = await db.select({ id: reservations.id }).from(reservations)
      .where(and(
        eq(reservations.orgId, orgId),
        eq(reservations.inventoryItemId, row.inventoryItemId),
        inArray(reservations.status, ["booked", "dispatched"]),
      )).limit(1);
    if (!stillActive) {
      await db.update(inventoryItems).set({ status: "in_store" }).where(and(
        eq(inventoryItems.orgId, orgId),
        eq(inventoryItems.id, row.inventoryItemId),
        eq(inventoryItems.status, "reserved"),
      ));
    }

    revalidatePath(`/projects/${row.projectId}`);
    revalidatePath("/projects/inventory");
    return { success: true };
  });
}
