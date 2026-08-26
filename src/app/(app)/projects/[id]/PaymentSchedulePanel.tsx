"use client";

import { useState } from "react";
import Link from "next/link";
import { addMilestoneAction, deleteMilestoneAction, generateInvoiceForMilestoneAction } from "@/lib/payment-schedule";
import { milestoneAmountCents } from "@/lib/milestone-amount";
import { fmtKES } from "@/lib/money";

type Milestone = {
  id: number;
  milestoneName: string;
  triggerType: string;
  triggerValue: string | null;
  amountType: string;
  percentageValue: number | null;
  fixedAmountCents: number | null;
  sequenceOrder: number;
  documentId: number | null;
  docNumber: string | null;
  docStatus: string | null;
  docTotalCents: number | null;
  docPaidCents: number | null;
};

const triggerLabels: Record<string, string> = {
  on_confirmation: "On confirmation",
  fixed_date: "On a fixed date",
  days_before_event: "Days before the event",
};

export function PaymentSchedulePanel({
  projectId,
  budgetCents,
  hasClient,
  milestones,
}: {
  projectId: number;
  budgetCents: number;
  hasClient: boolean;
  milestones: Milestone[];
}) {
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amountType, setAmountType] = useState("percentage");

  async function generate(id: number) {
    setError(null);
    setPendingId(id);
    try {
      await generateInvoiceForMilestoneAction(id);
      window.location.reload();
    } catch (e: any) {
      setError(e.message ?? "Couldn't generate the invoice");
    } finally {
      setPendingId(null);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this milestone?")) return;
    try {
      await deleteMilestoneAction(id);
      window.location.reload();
    } catch (e: any) {
      alert(e.message ?? "Couldn't delete");
    }
  }

  async function submit(formData: FormData) {
    setError(null);
    try {
      await addMilestoneAction(projectId, formData);
      window.location.reload();
    } catch (e: any) {
      setError(e.message ?? "Couldn't add the milestone");
    }
  }

  return (
    <div className="space-y-4">
      {!hasClient && (
        <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5 text-[12.5px] text-[var(--color-warn)]">
          No client assigned yet — you can set up the schedule now, but generating an invoice needs a client on the project first.
        </div>
      )}

      {milestones.length > 0 && (
        <div className="space-y-2">
          {milestones.map((m) => {
            const amount = milestoneAmountCents(m, budgetCents);
            return (
              <div key={m.id} className="flex items-center justify-between rounded-lg border border-[var(--color-ink-100)] px-3 py-2 text-[13px]">
                <div>
                  <div className="font-medium">{m.milestoneName}</div>
                  <div className="text-[11.5px] text-[var(--color-ink-400)]">
                    {m.amountType === "percentage" ? `${m.percentageValue}% of budget` : "Fixed amount"} · {fmtKES(amount)} · {triggerLabels[m.triggerType] ?? m.triggerType}
                    {m.triggerValue ? ` (${m.triggerValue})` : ""}
                  </div>
                </div>
                {m.documentId ? (
                  <Link href={`/sales/invoices/${m.documentId}`} className="text-[12px] text-[var(--color-accent-600)] hover:underline shrink-0 ml-3">
                    {m.docNumber} — {m.docStatus}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <button
                      disabled={pendingId === m.id || !hasClient}
                      onClick={() => generate(m.id)}
                      className="text-[12px] font-medium text-[var(--color-accent-600)] hover:underline disabled:opacity-50 disabled:no-underline"
                    >
                      {pendingId === m.id ? "Generating…" : "Generate invoice"}
                    </button>
                    <button onClick={() => remove(m.id)} className="text-[12px] text-[var(--color-bad)] hover:underline">Delete</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <div className="text-[12px] text-[var(--color-bad)]">{error}</div>}

      <form action={submit} className="rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 space-y-2.5">
        <div className="text-[12px] font-medium text-[var(--color-ink-600)]">Add a milestone</div>
        <input name="milestoneName" type="text" required placeholder="e.g. Booking Deposit" className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
        <div className="grid grid-cols-2 gap-2">
          <select name="triggerType" defaultValue="on_confirmation" className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]">
            <option value="on_confirmation">On confirmation</option>
            <option value="fixed_date">On a fixed date</option>
            <option value="days_before_event">Days before event</option>
          </select>
          <input name="triggerValue" type="text" placeholder="Date or number of days" className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select name="amountType" value={amountType} onChange={(e) => setAmountType(e.target.value)} className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]">
            <option value="percentage">% of budget</option>
            <option value="fixed">Fixed amount (KES)</option>
          </select>
          {amountType === "percentage" ? (
            <input name="percentageValue" type="number" step="0.1" min="0.1" max="100" placeholder="e.g. 30" className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
          ) : (
            <input name="fixedAmount" type="number" step="0.01" min="0.01" placeholder="0.00" className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
          )}
        </div>
        <button type="submit" className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[13px] font-medium px-4 py-2 transition-colors">
          Add milestone
        </button>
      </form>
    </div>
  );
}
