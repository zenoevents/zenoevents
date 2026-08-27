"use server";

import { db, inventoryItems, reservations, items, projects, warehouses } from "@/db";
import { eq, and, ne, sql, inArray } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { nowISO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import type { InventoryStatus } from "@/lib/inventory-status";
import { saveItem } from "@/lib/actions";

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

/** Every non-archived item except the built-in "service" kind — a service
 *  can never be a physical rental unit. `kind` is an org-customizable
 *  taxonomy label (see item-types.ts), not used in accounting logic, so
 *  this exclusion is purely a UX guard against picking the wrong item —
 *  custom org-defined kinds are left alone since their semantics aren't
 *  knowable generically. */
export async function listCatalogItems() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db.select({ id: items.id, name: items.name })
      .from(items)
      .where(and(eq(items.orgId, orgId), eq(items.archived, false), ne(sql`lower(${items.kind})`, "service")))
      .orderBy(items.name);
  });
}

/** How many Event Inventory instances exist per catalog item — the cross-
 *  link the Items & Stock list shows ("N rental units"), so a client
 *  browsing the catalog can see the other half of the same item instead of
 *  the two screens looking unrelated. */
export async function countInventoryInstancesByItem(): Promise<Record<number, number>> {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const rows = await db
      .select({ itemId: inventoryItems.itemId, count: sql<number>`count(*)`.mapWith(Number) })
      .from(inventoryItems)
      .where(eq(inventoryItems.orgId, orgId))
      .groupBy(inventoryItems.itemId);
    return Object.fromEntries(rows.map((r) => [r.itemId, r.count]));
  });
}

async function insertInventoryInstance(orgId: number, itemId: number, label: string, qty: number, warehouseId: number | null) {
  await db.insert(inventoryItems).values({
    orgId, itemId, label, qty, warehouseId,
    condition: "good",
    status: "in_store",
    createdAt: nowISO(),
  });
  await logAudit({ action: "inventory_item.create", module: "projects", recordLabel: label });
  revalidatePath("/projects/inventory");
  revalidatePath("/items");
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

    await insertInventoryInstance(orgId, itemId, label, qty, warehouseId);
    return { success: true };
  });
}

/**
 * The single "New item" flow for Event Inventory — either picks an existing
 * catalog item, or creates one on the fly (mirroring createItemFromLine's
 * precedent in actions.ts: a new catalog item can be created from a
 * different permission surface without requiring the separate "items"
 * permission, since the caller's own page — here, "projects" — already
 * gates it) with sensible rental-gear defaults, then creates the first
 * batch against it either way. Not a data-model change: still the same
 * saveItem()/inventoryItems insert as always, just one round-trip instead
 * of two page visits.
 */
export async function createInventoryItemWithCatalogAction(formData: FormData): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const label = (formData.get("label") as string)?.trim();
      const qty = parseFloat((formData.get("qty") as string) || "1");
      const warehouseIdRaw = formData.get("warehouseId") as string;
      const warehouseId = warehouseIdRaw ? parseInt(warehouseIdRaw, 10) : null;
      if (!label || !Number.isFinite(qty) || qty <= 0) {
        throw new Error("Label and a positive quantity are required");
      }

      const mode = formData.get("mode") as string;
      let itemId: number;

      if (mode === "existing") {
        itemId = parseInt(formData.get("itemId") as string, 10);
        if (!itemId) throw new Error("Pick a catalog item");
      } else {
        const name = (formData.get("newItemName") as string)?.trim();
        if (!name) throw new Error("Name is required for a new catalog item");
        itemId = await saveItem({
          kind: (formData.get("kind") as string) || "goods",
          itemGroupId: formData.get("itemGroupId") ? Number(formData.get("itemGroupId")) : null,
          name,
          sku: (formData.get("sku") as string) || undefined,
          unit: (formData.get("unit") as string) || "unit",
          salePriceCents: Math.round(parseFloat((formData.get("salePrice") as string) || "0") * 100) || 0,
          purchaseCostCents: Math.round(parseFloat((formData.get("purchaseCost") as string) || "0") * 100) || 0,
          taxClass: (formData.get("taxClass") as string) || "B16",
          // Rental gear cycles out and back — it's never FIFO-consumed like
          // sold/used stock, so this is always false for an item created
          // from this flow (matches every existing rental catalog item).
          trackInventory: false,
          reorderLevel: 0,
          purchaseAccountId: formData.get("purchaseAccountId") ? Number(formData.get("purchaseAccountId")) : null,
        });
      }

      await insertInventoryInstance(orgId, itemId, label, qty, warehouseId);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not create this item" };
  }
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

    const [project] = await db.select({ status: projects.status }).from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.id, params.projectId))).limit(1);
    const firm = !!project && ["confirmed", "in_progress", "completed"].includes(project.status);

    await db.insert(reservations).values({
      orgId,
      inventoryItemId: params.inventoryItemId,
      projectId: params.projectId,
      qty: params.qty,
      startDate: params.startDate,
      endDate: params.endDate,
      location: params.location?.trim() || null,
      status: firm ? "booked" : "quoted",
      createdAt: nowISO(),
    });

    if (firm) {
      await db.update(inventoryItems).set({ status: "reserved" }).where(and(
        eq(inventoryItems.orgId, orgId),
        eq(inventoryItems.id, params.inventoryItemId),
        eq(inventoryItems.status, "in_store"),
      ));
    }

    await logAudit({ action: "reservation.create", module: "projects", recordId: params.projectId, projectId: params.projectId });
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
