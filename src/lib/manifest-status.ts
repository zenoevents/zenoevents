/** Shared between the "use server" manifests.ts and client components —
 *  a "use server" file may only export async functions, so these constants
 *  and types live here instead. */

/** Coarse, admin-controlled overall stage. The real granularity is on each
 *  manifest_lines row (see LINE_STATUSES) — this is just "how far along is
 *  this project's fulfillment, roughly." */
export const MANIFEST_STATUSES = ["draft", "confirmed", "in_progress", "reconciled"] as const;
export type ManifestStatus = (typeof MANIFEST_STATUSES)[number];

/** Per-line checklist walk. A durable line goes all the way through;
 *  inspected_* are terminal outcomes set by warehouse staff on return.
 *  A consumable line only ever needs pending -> dispatched (it's expensed,
 *  not returned) — see isConsumableTerminal in manifests.ts. */
export const LINE_STATUSES = [
  "pending", "picked", "loaded", "dispatched", "collected", "returned",
  "inspected_good", "inspected_needs_cleaning", "inspected_damaged", "inspected_missing",
] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

/** Collapses a granular line status into one of the five post-confirmation
 *  lifecycle buckets — shared by the per-project Overview stepper
 *  (src/lib/projects.ts) and the org-wide manifest pipeline widget on the
 *  home dashboard, so both read the same "how far along" definition. */
export function lineFloorStage(status: string): "packing" | "loaded" | "dispatched" | "returned" | "inspected" {
  if (status.startsWith("inspected_")) return "inspected";
  if (status === "returned" || status === "collected") return "returned";
  if (status === "dispatched") return "dispatched";
  if (status === "loaded") return "loaded";
  return "packing"; // pending | picked
}

/** Which role is expected to perform each forward transition — used to
 *  gate the action buttons a given staff member sees, not just cosmetic. */
export const LINE_TRANSITIONS: Record<string, { to: LineStatus; role: "warehouse_staff" | "loading_staff" | "collection_staff"; label: string }[]> = {
  pending: [{ to: "picked", role: "warehouse_staff", label: "Mark picked" }],
  picked: [{ to: "loaded", role: "loading_staff", label: "Mark loaded" }],
  loaded: [{ to: "dispatched", role: "loading_staff", label: "Mark dispatched" }],
  dispatched: [{ to: "collected", role: "collection_staff", label: "Mark collected" }],
  collected: [{ to: "returned", role: "collection_staff", label: "Mark returned" }],
  // "returned" branches into an inspection outcome rather than a single next step —
  // handled explicitly in the UI (inspectLineAction), not via this table.
};

export const LINE_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  picked: "Picked",
  loaded: "Loaded",
  dispatched: "Dispatched",
  collected: "Collected",
  returned: "Returned — awaiting inspection",
  inspected_good: "Inspected — good",
  inspected_needs_cleaning: "Inspected — needs cleaning",
  inspected_damaged: "Inspected — damaged",
  inspected_missing: "Inspected — missing",
};
