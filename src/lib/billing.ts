export type AccessStatus = "active" | "locked";

/** Binary access model — replaces the old free/standard/business tier
 *  ladder. `paidUntil` means "access guaranteed through this date,"
 *  whether that date came from a signup trial, an admin extension, or a
 *  successful payment; there's no plan tier left to resolve against. */
export function resolveAccess(
  paidUntil: string,
  today = new Date().toISOString().slice(0, 10)
): { status: AccessStatus; paidUntil: string } {
  return { status: paidUntil >= today ? "active" : "locked", paidUntil };
}
