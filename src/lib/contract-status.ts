/** Shared between the "use server" contracts.ts and client components —
 *  a "use server" file may only export async functions, so these constants
 *  and types live here instead (same pattern as manifest-status.ts). */

export const CONTRACT_STATUSES = ["draft", "sent", "signed", "declined", "expired"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  signed: "Signed",
  declined: "Declined",
  expired: "Expired",
};
