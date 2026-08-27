"use client";

import { useState, useTransition } from "react";
import { setFeesAction, recordManualPaymentAction } from "../../actions";
import { fmtKES } from "@/lib/money";

type PaymentRow = { id: number; kind: string; amountCents: number; paidOn: string; method: string | null; note: string | null };

const inputCls = "rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 transition-all";

function RecordPaymentForm({ orgId, kind }: { orgId: number; kind: "one_time" | "maintenance" }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const fd = new FormData(e.currentTarget);
    fd.set("kind", kind);
    startTransition(async () => {
      const res = await recordManualPaymentAction(orgId, fd);
      if (res?.error) setError(res.error);
      else { setSuccess(true); (e.target as HTMLFormElement).reset(); }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 mt-2">
      <input name="amount" type="number" step="0.01" min="0" placeholder="Amount (KES)" required className={`${inputCls} w-32`} />
      <input name="paidOn" type="date" defaultValue={today} required className={inputCls} />
      <input name="method" type="text" placeholder="Method (M-Pesa, bank...)" className={`${inputCls} w-40`} />
      <input name="note" type="text" placeholder="Note (optional)" className={`${inputCls} w-40`} />
      <button type="submit" disabled={pending} className="rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-[12.5px] font-medium px-3 py-2 transition-colors">
        {pending ? "Saving…" : "Record"}
      </button>
      {error && <p className="w-full text-[12px] text-[var(--color-bad)]">{error}</p>}
      {success && <p className="w-full text-[12px] text-[var(--color-good)]">Recorded.</p>}
    </form>
  );
}

export function FeesPanel({
  orgId,
  oneTimeFeeCents,
  monthlyFeeCents,
  oneTimePayments,
  maintenancePayments,
}: {
  orgId: number;
  oneTimeFeeCents: number;
  monthlyFeeCents: number;
  oneTimePayments: PaymentRow[];
  maintenancePayments: PaymentRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleFeesSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await setFeesAction(orgId, fd);
      if (res?.error) setError(res.error);
      else setSuccess(true);
    });
  }

  const oneTimeTotal = oneTimePayments.reduce((s, p) => s + p.amountCents, 0);
  const maintenanceTotal = maintenancePayments.reduce((s, p) => s + p.amountCents, 0);

  return (
    <div className="space-y-5">
      <form onSubmit={handleFeesSubmit} className="flex flex-wrap items-end gap-3">
        <label>
          <span className="block text-[11.5px] font-medium text-[var(--color-ink-600)] mb-1">One-time fee (KES)</span>
          <input name="oneTimeFee" type="number" step="0.01" min="0" defaultValue={(oneTimeFeeCents / 100).toFixed(2)} className={`${inputCls} w-32`} />
        </label>
        <label>
          <span className="block text-[11.5px] font-medium text-[var(--color-ink-600)] mb-1">Monthly maintenance fee (KES)</span>
          <input name="monthlyFee" type="number" step="0.01" min="0" defaultValue={(monthlyFeeCents / 100).toFixed(2)} className={`${inputCls} w-32`} />
        </label>
        <button type="submit" disabled={pending} className="rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-[13px] font-medium px-4 py-2 transition-colors">
          {pending ? "Saving…" : "Save fees"}
        </button>
        {error && <p className="w-full text-[12px] text-[var(--color-bad)]">{error}</p>}
        {success && <p className="w-full text-[12px] text-[var(--color-good)]">Saved.</p>}
      </form>

      <div className="pt-3 border-t border-[var(--color-ink-100)]">
        <div className="text-[12.5px] font-medium mb-1">
          One-time fee — {fmtKES(oneTimeTotal)} recorded of {fmtKES(oneTimeFeeCents)}
        </div>
        {oneTimePayments.length > 0 && (
          <ul className="text-[12px] text-[var(--color-ink-600)] space-y-1 mb-1">
            {oneTimePayments.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span>{p.paidOn}{p.method ? ` · ${p.method}` : ""}{p.note ? ` · ${p.note}` : ""}</span>
                <span className="font-medium tnum">{fmtKES(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
        <RecordPaymentForm orgId={orgId} kind="one_time" />
      </div>

      <div className="pt-3 border-t border-[var(--color-ink-100)]">
        <div className="text-[12.5px] font-medium mb-1">
          Maintenance fee — {fmtKES(maintenanceTotal)} recorded total
        </div>
        {maintenancePayments.length > 0 && (
          <ul className="text-[12px] text-[var(--color-ink-600)] space-y-1 mb-1">
            {maintenancePayments.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span>{p.paidOn}{p.method ? ` · ${p.method}` : ""}{p.note ? ` · ${p.note}` : ""}</span>
                <span className="font-medium tnum">{fmtKES(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
        <RecordPaymentForm orgId={orgId} kind="maintenance" />
      </div>
    </div>
  );
}
