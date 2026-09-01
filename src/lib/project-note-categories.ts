/** Shared category metadata — badge label/icon/color, one place so the
 *  staff panel and the client-portal (read-only) view render identically. */
export const NOTE_CATEGORIES = ["client_update", "follow_up", "payment", "venue", "internal"] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];

export const NOTE_CATEGORY_META: Record<NoteCategory, { label: string; icon: string; color: string; bg: string }> = {
  client_update: { label: "Client Update", icon: "💬", color: "#0f766e", bg: "#ecfdf5" },
  follow_up: { label: "Follow-up", icon: "⏰", color: "#b45309", bg: "#fffbeb" },
  payment: { label: "Payment", icon: "💰", color: "#166534", bg: "#f0fdf4" },
  venue: { label: "Venue / Logistics", icon: "📍", color: "#5b21b6", bg: "#f5f3ff" },
  internal: { label: "Internal", icon: "🔒", color: "#525252", bg: "#f5f5f5" },
};
