"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { portalAcceptContractAction, portalDeclineContractAction, portalSignContractAction } from "@/lib/client-portal/contracts";

export function ContractAcceptButtons({ orgSlug, contractId, suggestedName }: { orgSlug: string; contractId: number; suggestedName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [typedName, setTypedName] = useState(suggestedName);

  function accept() {
    setError(null);
    start(async () => {
      const res = await portalAcceptContractAction(orgSlug, contractId);
      if ("error" in res) setError(res.error);
      else setAccepted(true);
    });
  }

  function sign() {
    setError(null);
    if (!typedName.trim()) { setError("Type your full name to sign"); return; }
    start(async () => {
      const res = await portalSignContractAction(orgSlug, contractId, typedName);
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

  if (accepted) {
    return (
      <div className="mt-2 rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 space-y-2">
        <div className="text-[11.5px] text-[var(--color-ink-500)]">You've agreed to the terms above. Type your full name below to sign.</div>
        <input
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder="Your full name"
          className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[15px] italic outline-none focus:border-[var(--color-accent-500)]"
          style={{ fontFamily: "cursive" }}
        />
        {error && <div className="text-[11.5px] text-[var(--color-bad)]">{error}</div>}
        <div className="flex gap-2">
          <button onClick={sign} disabled={pending} className="flex-1 rounded-lg bg-[var(--color-good)] text-white text-[12.5px] font-medium px-3 py-2 disabled:opacity-50">
            {pending ? "…" : "Sign & Confirm"}
          </button>
          <button onClick={() => setAccepted(false)} disabled={pending} className="rounded-lg bg-white border border-[var(--color-ink-200)] text-[var(--color-ink-700)] text-[12.5px] font-medium px-3 py-2">
            Back
          </button>
        </div>
      </div>
    );
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
