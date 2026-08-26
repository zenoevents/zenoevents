/** Shared between the "use server" damage-reports.ts and client components —
 *  a "use server" file may only export async functions, so this constant
 *  and type live here instead. */
export const LIABILITY_STATUSES = ["pending", "staff_fault", "client_fault", "wear_and_tear", "unresolved"] as const;
export type LiabilityStatus = (typeof LIABILITY_STATUSES)[number];

export const DAMAGE_TYPES = ["broken", "chipped", "stained", "missing", "other"] as const;
export const STAGE_OPTIONS = ["loading", "collection", "inspection"] as const;
