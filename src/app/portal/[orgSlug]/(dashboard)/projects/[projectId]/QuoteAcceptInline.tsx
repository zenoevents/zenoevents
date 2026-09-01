"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { portalAcceptQuoteAction, portalDeclineQuoteAction } from "../../documents/actions";

export function QuoteAcceptInline({ orgSlug, documentId }: { orgSlug: string; documentId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function accept() {
    setError(null);
    start(async () => {
      const res = await portalAcceptQuoteAction(orgSlug, documentId);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  function decline() {
    if (!confirm("Decline this quote? Reach out to us if you'd like changes instead.")) return;
    setError(null);
    start(async () => {
      const res = await portalDeclineQuoteAction(orgSlug, documentId);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <span className="flex items-center gap-1.5">
      {error && <span className="text-[11px] text-[var(--color-bad)]">{error}</span>}
      <button onClick={accept} disabled={pending} className="px-2 py-0.5 bg-[var(--color-good)] text-white text-[11px] font-semibold rounded disabled:opacity-50">
        {pending ? "…" : "Accept"}
      </button>
      <button onClick={decline} disabled={pending} className="px-2 py-0.5 border border-[var(--color-ink-200)] text-[var(--color-ink-700)] text-[11px] font-medium rounded disabled:opacity-50">
        Decline
      </button>
    </span>
  );
}
