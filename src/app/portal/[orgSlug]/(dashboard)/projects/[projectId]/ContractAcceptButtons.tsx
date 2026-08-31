"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { portalAcceptContractAction, portalDeclineContractAction } from "@/lib/client-portal/contracts";

export function ContractAcceptButtons({ orgSlug, contractId }: { orgSlug: string; contractId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function accept() {
    setError(null);
    start(async () => {
      const res = await portalAcceptContractAction(orgSlug, contractId);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  function decline() {
    if (!confirm("Decline this contract? This can't be undone from here — reach out to us to sort it out.")) return;
    setError(null);
    start(async () => {
      const res = await portalDeclineContractAction(orgSlug, contractId);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <button onClick={accept} disabled={pending} className="flex-1 rounded-lg bg-[var(--color-good)] text-white text-[12.5px] font-medium px-3 py-2 disabled:opacity-50">
          {pending ? "…" : "Accept"}
        </button>
        <button onClick={decline} disabled={pending} className="flex-1 rounded-lg bg-white border border-[var(--color-ink-200)] text-[var(--color-ink-700)] text-[12.5px] font-medium px-3 py-2 disabled:opacity-50">
          Decline
        </button>
      </div>
      {error && <div className="text-[11.5px] text-[var(--color-bad)] mt-1.5">{error}</div>}
    </div>
  );
}
