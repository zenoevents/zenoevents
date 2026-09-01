import { fmtKES } from "@/lib/money";

export interface RingData {
  label: string;
  pct: number; // 0-100
  color: string;
  colorSoft: string;
  detail: string;
}

/** Plain data function — kept out of ActivityRings.tsx ("use client")
 *  since a server component can't call a function from a client module,
 *  only render it as a component or pass it as a prop. */
export function buildActivityRings({
  collectedCents,
  invoicedCents,
  budgetCents,
  stageIndex,
  stageCount,
  createdAt,
  eventDate,
  isPastOrDone,
}: {
  collectedCents: number;
  invoicedCents: number;
  budgetCents: number;
  stageIndex: number;
  stageCount: number;
  createdAt: string;
  eventDate: string;
  isPastOrDone: boolean;
}): [RingData, RingData, RingData] {
  const paymentBase = invoicedCents > 0 ? invoicedCents : budgetCents;
  const paymentPct = paymentBase > 0 ? (collectedCents / paymentBase) * 100 : 0;

  const bookingPct = stageCount > 1 ? (stageIndex / (stageCount - 1)) * 100 : 100;

  let timePct = 100;
  if (!isPastOrDone) {
    const start = new Date(createdAt).getTime();
    const end = new Date(eventDate).getTime();
    const now = Date.now();
    timePct = end > start ? ((now - start) / (end - start)) * 100 : 100;
  }

  return [
    { label: "Payment", pct: paymentPct, color: "#0f766e", colorSoft: "#0f766e22", detail: `${fmtKES(collectedCents)} of ${fmtKES(paymentBase)}` },
    { label: "Booking", pct: bookingPct, color: "#2563eb", colorSoft: "#2563eb22", detail: `Stage ${stageIndex + 1} of ${stageCount}` },
    { label: "Timeline", pct: Math.max(0, Math.min(100, timePct)), color: "#a855f7", colorSoft: "#a855f722", detail: isPastOrDone ? "Event day reached" : "Time until event" },
  ];
}
