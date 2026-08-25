/** Shared between the "use server" projects.ts and client components —
 *  a "use server" file may only export async functions, so this constant
 *  and type live here instead. */
export const PROJECT_STATUSES = ["lead", "quoted", "confirmed", "in_progress", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
