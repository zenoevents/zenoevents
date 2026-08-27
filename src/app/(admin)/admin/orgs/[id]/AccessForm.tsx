"use client";

import { useState, useTransition } from "react";
import { setAccessAction } from "../../actions";

export function AccessForm({ orgId, currentPaidUntil }: { orgId: number; currentPaidUntil: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await setAccessAction(orgId, fd);
      if (res?.error) setError(res.error);
      else setSuccess(true);
    });
  }

  const inputCls = "rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 transition-all";

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <label>
        <span className="block text-[11.5px] font-medium text-[var(--color-ink-600)] mb-1">Access until</span>
        <input type="date" name="paidUntil" defaultValue={currentPaidUntil} className={inputCls} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-[13px] font-medium px-4 py-2 transition-colors"
      >
        {pending ? "Saving…" : "Apply"}
      </button>
      {error && <p className="w-full text-[12px] text-[var(--color-bad)]">{error}</p>}
      {success && <p className="w-full text-[12px] text-[var(--color-good)]">Updated. Change is live for the tenant immediately.</p>}
      <p className="w-full text-[11px] text-[var(--color-ink-400)]">Extend to reactivate/extend trial or subscription. Set a past date to lock the org immediately.</p>
    </form>
  );
}
