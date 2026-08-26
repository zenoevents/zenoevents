/** Shared between the "use server" payment-schedule.ts and client
 *  components — a "use server" file may only export async functions, so
 *  this pure calculation lives here instead. */
export function milestoneAmountCents(
  m: { amountType: string; percentageValue: number | null; fixedAmountCents: number | null },
  budgetCents: number
): number {
  if (m.amountType === "fixed") return m.fixedAmountCents ?? 0;
  return Math.round((budgetCents * (m.percentageValue ?? 0)) / 100);
}
