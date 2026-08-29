"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertLeadAction } from "@/lib/leads";

export function ConvertButton({ leadId, alreadyConvertedProjectId }: { leadId: number; alreadyConvertedProjectId: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (alreadyConvertedProjectId) {
    return (
      <a href={`/projects/${alreadyConvertedProjectId}`} className="block w-full text-center rounded-md bg-emerald-50 text-emerald-700 text-[12.5px] font-medium py-2 hover:bg-emerald-100">
        ✓ Converted — view project
      </a>
    );
  }

  function convert() {
    setError(null);
    start(async () => {
      const res = await convertLeadAction(leadId);
      if ("error" in res) setError(res.error);
      else router.push(`/projects/${res.projectId}`);
    });
  }

  return (
    <div className="space-y-2">
      {error && <div className="text-[12px] text-[var(--color-bad)]">{error}</div>}
      <button
        onClick={convert}
        disabled={pending}
        className="w-full rounded-md bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-50 text-white text-[12.5px] font-medium py-2"
      >
        {pending ? "Converting…" : "Convert to Project"}
      </button>
    </div>
  );
}
