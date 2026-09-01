"use server";

import { db, hireContracts, inventoryItems, items, reservations } from "@/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { nowISO, todayISO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

/** Hiring the org's own gear out to another event company — a distinct
 *  contract type from an internal project reservation, sharing the same
 *  inventoryItems.status field ("on_external_hire") that reservations
 *  already use ("reserved"/"dispatched") — same coarse, whole-batch status
 *  model as the rest of Event Inventory, not a new per-unit system. */
export async function listHireContracts() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const rows = await db
      .select({
        id: hireContracts.id,
        inventoryItemId: hireContracts.inventoryItemId,
        label: inventoryItems.label,
        itemName: items.name,
        qty: hireContracts.qty,
        externalClientName: hireContracts.externalClientName,
        externalClientPhone: hireContracts.externalClientPhone,
        startDate: hireContracts.startDate,
        endDate: hireContracts.endDate,
        actualReturnDate: hireContracts.actualReturnDate,
        hireFeeCents: hireContracts.hireFeeCents,
        depositCents: hireContracts.depositCents,
        depositReturned: hireContracts.depositReturned,
        status: hireContracts.status,
        createdAt: hireContracts.createdAt,
      })
      .from(hireContracts)
      .leftJoin(inventoryItems, eq(inventoryItems.id, hireContracts.inventoryItemId))
      .leftJoin(items, eq(items.id, inventoryItems.itemId))
      .where(eq(hireContracts.orgId, orgId))
      .orderBy(desc(hireContracts.createdAt));

    const today = todayISO();
    // "Overdue" is derived at read time (still "out" past its end date),
    // not a separately-set status — nothing else in this codebase runs a
    // background job to flip stored statuses on a timer, so this follows
    // the same convention documents/tasks already use for "overdue".
    return rows.map((r) => ({ ...r, effectiveStatus: r.status === "out" && r.endDate < today ? "overdue" : r.status }));
  });
}

/** Inventory instances currently available to hire out — same "in_store
 *  only" rule reservations effectively enforce, just checked up front here
 *  instead of via a conflict list (hire-out has no date-range overlap
 *  concept the way internal reservations do — one status field, whole
 *  batch, matches the existing coarse model). */
export async function listHireableInventory() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select({ id: inventoryItems.id, label: inventoryItems.label, qty: inventoryItems.qty, itemName: items.name })
      .from(inventoryItems)
      .leftJoin(items, eq(items.id, inventoryItems.itemId))
      .where(and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.status, "in_store")))
      .orderBy(items.name, inventoryItems.label);
  });
}

export async function createHireContractAction(formData: FormData): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const inventoryItemId = parseInt(formData.get("inventoryItemId") as string, 10);
      const qty = parseFloat((formData.get("qty") as string) || "1");
      const externalClientName = (formData.get("externalClientName") as string)?.trim();
      const externalClientPhone = (formData.get("externalClientPhone") as string) || null;
      const startDate = formData.get("startDate") as string;
      const endDate = formData.get("endDate") as string;
      const hireFeeCents = Math.round(parseFloat((formData.get("hireFee") as string) || "0") * 100);
      const depositCents = Math.round(parseFloat((formData.get("deposit") as string) || "0") * 100);

      if (!inventoryItemId || !externalClientName || !startDate || !endDate) {
        throw new Error("Item, client name, and dates are required");
      }
      if (startDate > endDate) throw new Error("Start date must be before end date");

      const [item] = await db.select({ id: inventoryItems.id, status: inventoryItems.status, label: inventoryItems.label })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.id, inventoryItemId))).limit(1);
      if (!item) throw new Error("Inventory item not found");
      if (item.status !== "in_store") throw new Error(`"${item.label}" is currently ${item.status.replace(/_/g, " ")} — it needs to be back in store before it can be hired out`);

      const [row] = await db.insert(hireContracts).values({
        orgId, inventoryItemId, qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        externalClientName, externalClientPhone,
        startDate, endDate,
        hireFeeCents: Number.isFinite(hireFeeCents) ? Math.max(0, hireFeeCents) : 0,
        depositCents: Number.isFinite(depositCents) ? Math.max(0, depositCents) : 0,
        depositReturned: false,
        status: "out",
        createdAt: nowISO(),
      }).returning({ id: hireContracts.id });

      await db.update(inventoryItems).set({ status: "on_external_hire" }).where(eq(inventoryItems.id, inventoryItemId));

      await logAudit({ action: "hire_contract.create", module: "projects", recordId: row.id, recordLabel: `${item.label} -> ${externalClientName}` });
      revalidatePath("/projects/inventory/hire");
      revalidatePath("/projects/inventory");
      return { success: true };
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create this hire contract" };
  }
}

export async function markHireReturnedAction(id: number, depositReturned: boolean): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [row] = await db.select().from(hireContracts)
        .where(and(eq(hireContracts.orgId, orgId), eq(hireContracts.id, id))).limit(1);
      if (!row) throw new Error("Hire contract not found");
      if (row.status === "returned") throw new Error("Already marked returned");

      await db.update(hireContracts).set({
        status: "returned",
        actualReturnDate: todayISO(),
        depositReturned,
      }).where(eq(hireContracts.id, id));

      // Only revert the item to in_store if nothing else currently has it
      // out — mirrors cancelReservationAction's guarded revert exactly.
      const [stillOut] = await db.select({ id: hireContracts.id }).from(hireContracts)
        .where(and(eq(hireContracts.orgId, orgId), eq(hireContracts.inventoryItemId, row.inventoryItemId), eq(hireContracts.status, "out"))).limit(1);
      const [stillReserved] = await db.select({ id: reservations.id }).from(reservations)
        .where(and(eq(reservations.orgId, orgId), eq(reservations.inventoryItemId, row.inventoryItemId), inArray(reservations.status, ["booked", "dispatched"]))).limit(1);
      if (!stillOut && !stillReserved) {
        await db.update(inventoryItems).set({ status: "in_store" }).where(and(
          eq(inventoryItems.orgId, orgId), eq(inventoryItems.id, row.inventoryItemId), eq(inventoryItems.status, "on_external_hire"),
        ));
      }

      await logAudit({ action: "hire_contract.return", module: "projects", recordId: id });
      revalidatePath("/projects/inventory/hire");
      revalidatePath("/projects/inventory");
      return { success: true };
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not mark this returned" };
  }
}
