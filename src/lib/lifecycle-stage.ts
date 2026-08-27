/** Shared between the "use server" projects.ts and client/server components —
 *  a "use server" file may only export async functions, so this type and
 *  constant live here instead. Synthetic stage combining project.status
 *  (pre-confirmation) with the manifest's slowest durable line (post-
 *  confirmation) — see getProjectOverviewStats in projects.ts. */
export const LIFECYCLE_STAGES = [
  { key: "draft", label: "Draft" },
  { key: "confirmed", label: "Confirmed" },
  { key: "packing", label: "Packing" },
  { key: "loaded", label: "Loaded" },
  { key: "dispatched", label: "Dispatched" },
  { key: "returned", label: "Returned" },
  { key: "inspected", label: "Inspected" },
  { key: "reconciled", label: "Reconciled" },
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number]["key"];
