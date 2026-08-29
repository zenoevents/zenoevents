/** Shared constants — kept out of leads.ts since that's a "use server" file
 *  (can only export async functions) and these are used from client/UI code too. */

export const LEAD_CHANNELS = ["instagram", "facebook", "website", "whatsapp", "qr", "manual", "referral"] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];
// Manual + Referral are staff-initiated — always available, nothing public
// to toggle off. Every other channel exposes a public link/embed/QR.
export const PUBLIC_LEAD_CHANNELS = ["instagram", "facebook", "website", "whatsapp", "qr"] as const;

export const LEAD_STAGES = ["new", "contacted", "quote_sent", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  quote_sent: "Quote sent",
  won: "Won 🎉",
  lost: "Lost",
};
