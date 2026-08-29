"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateLeadStageAction } from "@/lib/leads";
import { LEAD_STAGES, LEAD_STAGE_LABELS, type LeadStage } from "@/lib/lead-constants";

export function StageForm({ leadId, currentStage, currentLostReason }: { leadId: number; currentStage: string; currentLostReason: string | null }) {
  const router = useRouter();
  const [stage, setStage] = useState(currentStage);
  const [lostReason, setLostReason] = useState(currentLostReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      try {
        await updateLeadStageAction(leadId, stage, lostReason);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update stage");
      }
    });
  }

  return (
    <div className="space-y-2">
      <select value={stage} onChange={(e) => setStage(e.target.value)} className="w-full rounded-md border border-[var(--color-ink-200)] px-2 py-2 text-[13px] bg-white">
        {LEAD_STAGES.map((s) => (
          <option key={s} value={s}>{LEAD_STAGE_LABELS[s as LeadStage]}</option>
        ))}
      </select>
      <input
        value={lostReason}
        onChange={(e) => setLostReason(e.target.value)}
        placeholder="Reason if marking Lost (price, date conflict, went cold…)"
        className="w-full rounded-md border border-[var(--color-ink-200)] px-2 py-2 text-[12.5px]"
      />
      {error && <div className="text-[12px] text-[var(--color-bad)]">{error}</div>}
      <button
        onClick={submit}
        disabled={pending}
        className="w-full rounded-md bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-50 text-white text-[12.5px] font-medium py-2"
      >
        {pending ? "Updating…" : "Update stage"}
      </button>
    </div>
  );
}
