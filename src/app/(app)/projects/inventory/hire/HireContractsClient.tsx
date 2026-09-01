"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createHireContractAction, markHireReturnedAction, generateHireInvoiceAction } from "@/lib/hire-contracts";
import { fmtKES } from "@/lib/money";
import { EmptyState, Th, Td, TableCard } from "@/components/ui";

interface HireableItem { id: number; label: string; qty: number; itemName: string | null }
interface ContractRow {
  id: number;
  inventoryItemId: number;
  label: string | null;
  itemName: string | null;
  qty: number;
  externalClientName: string;
  externalClientPhone: string | null;
  startDate: string;
  endDate: string;
  actualReturnDate: string | null;
  hireFeeCents: number;
  depositCents: number;
  depositReturned: boolean;
  status: string;
  effectiveStatus: string;
  documentId: number | null;
}

const STATUS_STYLE: Record<string, string> = {
  out: "bg-orange-50 text-orange-700",
  overdue: "bg-red-50 text-red-700",
  returned: "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]",
};

const inputCls = "w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]";
const labelCls = "text-[12px] font-medium text-[var(--color-ink-600)]";

export function HireContractsClient({ contracts, hireableItems }: { contracts: ContractRow[]; hireableItems: HireableItem[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    start(async () => {
      const res = await createHireContractAction(formData);
      if ("error" in res) setError(res.error);
      else { setShowForm(false); router.refresh(); }
    });
  }

  function markReturned(id: number) {
    const depositReturned = confirm("Return the deposit to the hiring company too? OK = yes, Cancel = keep deposit / no deposit was taken.");
    start(async () => {
      await markHireReturnedAction(id, depositReturned);
      router.refresh();
    });
  }

  function generateInvoice(id: number) {
    setError(null);
    start(async () => {
      const res = await generateHireInvoiceAction(id);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[13px] font-medium px-4 py-2"
        >
          {showForm ? "Cancel" : "+ New hire-out"}
        </button>
      </div>

      {showForm && (
        <form action={submit} className="card p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          <label className="block col-span-2">
            <span className={labelCls}>Item</span>
            <select name="inventoryItemId" required defaultValue="" className={inputCls + " mt-1"}>
              <option value="" disabled>Select an in-store item…</option>
              {hireableItems.map((i) => (
                <option key={i.id} value={i.id}>{i.itemName} — {i.label} ({i.qty})</option>
              ))}
            </select>
            {hireableItems.length === 0 && (
              <p className="text-[11.5px] text-[var(--color-ink-400)] mt-1">Nothing currently in store — items reserved, dispatched, or already on hire aren't eligible until they're back.</p>
            )}
          </label>
          <label className="block">
            <span className={labelCls}>Qty</span>
            <input name="qty" type="number" min="1" step="1" defaultValue="1" className={inputCls + " mt-1"} />
          </label>
          <label className="block">
            <span className={labelCls}>Hiring company</span>
            <input name="externalClientName" required placeholder="e.g. Sunset Events Co." className={inputCls + " mt-1"} />
          </label>
          <label className="block">
            <span className={labelCls}>Their phone</span>
            <input name="externalClientPhone" placeholder="0722 000 000" className={inputCls + " mt-1"} />
          </label>
          <label className="block">
            <span className={labelCls}>Start date</span>
            <input name="startDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputCls + " mt-1"} />
          </label>
          <label className="block">
            <span className={labelCls}>Expected return date</span>
            <input name="endDate" type="date" required className={inputCls + " mt-1"} />
          </label>
          <label className="block">
            <span className={labelCls}>Hire fee (KES)</span>
            <input name="hireFee" type="number" step="0.01" min="0" placeholder="0.00" className={inputCls + " mt-1"} />
          </label>
          <label className="block">
            <span className={labelCls}>Deposit held (KES)</span>
            <input name="deposit" type="number" step="0.01" min="0" placeholder="0.00" className={inputCls + " mt-1"} />
          </label>
          {error && <div className="col-span-2 text-[12.5px] text-[var(--color-bad)]">{error}</div>}
          <div className="col-span-2">
            <button disabled={pending} className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-50 text-white text-[13px] font-medium px-5 py-2.5">
              {pending ? "Creating…" : "Create hire-out"}
            </button>
          </div>
        </form>
      )}

      {contracts.length === 0 ? (
        <EmptyState title="Nothing hired out yet" body="When another event company borrows your gear, track it here — who has it, when it's due back, the fee and deposit." />
      ) : (
        <TableCard>
          <thead>
            <tr className="hairline-b">
              <Th>Item</Th>
              <Th>Hired to</Th>
              <Th>Out</Th>
              <Th>Due back</Th>
              <Th right>Fee</Th>
              <Th right>Deposit</Th>
              <Th>Status</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id} className="hairline-t hover:bg-[var(--color-ink-50)]">
                <Td className="font-medium">{c.itemName} <span className="text-[var(--color-ink-400)] font-normal">— {c.label}</span></Td>
                <Td>{c.externalClientName}{c.externalClientPhone ? ` · ${c.externalClientPhone}` : ""}</Td>
                <Td>{c.startDate}</Td>
                <Td>{c.actualReturnDate ? `Returned ${c.actualReturnDate}` : c.endDate}</Td>
                <Td right>{fmtKES(c.hireFeeCents)}</Td>
                <Td right>
                  {fmtKES(c.depositCents)}
                  {c.status === "returned" && c.depositCents > 0 && (
                    <span className={`ml-1.5 text-[10.5px] ${c.depositReturned ? "text-emerald-600" : "text-amber-600"}`}>
                      {c.depositReturned ? "returned" : "kept"}
                    </span>
                  )}
                </Td>
                <Td>
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[c.effectiveStatus] ?? STATUS_STYLE.out}`}>
                    {c.effectiveStatus === "out" ? "On hire" : c.effectiveStatus === "overdue" ? "Overdue" : "Returned"}
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center gap-3">
                    {c.status !== "returned" && (
                      <button onClick={() => markReturned(c.id)} disabled={pending} className="text-[12px] text-[var(--color-accent-600)] font-medium hover:underline disabled:opacity-50">
                        Mark returned
                      </button>
                    )}
                    {c.documentId ? (
                      <a href={`/sales/invoices/${c.documentId}`} className="text-[12px] text-[var(--color-ink-500)] font-medium hover:underline">
                        Invoice ↗
                      </a>
                    ) : c.hireFeeCents > 0 ? (
                      <button onClick={() => generateInvoice(c.id)} disabled={pending} className="text-[12px] text-[var(--color-accent-600)] font-medium hover:underline disabled:opacity-50">
                        Generate invoice
                      </button>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
    </div>
  );
}
