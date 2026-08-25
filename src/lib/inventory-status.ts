/** Shared between the "use server" inventory-instances.ts and any client
 *  components — a "use server" file may only export async functions, so
 *  this constant and type live here instead. */
export const INVENTORY_STATUSES = [
  "in_store", "reserved", "dispatched", "at_event", "returned", "damaged", "on_external_hire",
] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];
