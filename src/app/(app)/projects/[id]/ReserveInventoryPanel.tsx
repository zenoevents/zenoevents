"use client";

import { useState } from "react";
import { createReservationAction, cancelReservationAction } from "@/lib/inventory-instances";

type InventoryOption = { id: number; label: string; itemName: string | null; status: string };
type ReservationRow = {
  id: number;
  inventoryItemId: number;
  label: string | null;
  itemName: string | null;
  qty: number;
  startDate: string;
  endDate: string;
  location: string | null;
  status: string;
};

export function ReserveInventoryPanel({
  projectId,
  eventDate,
  inventoryOptions,
  reservations,
}: {
  projectId: number;
  eventDate: string;
  inventoryOptions: InventoryOption[];
  reservations: ReservationRow[];
}) {
  const [inventoryItemId, setInventoryItemId] = useState<number | "">("");
  const [qty, setQty] = useState("1");
  const [startDate, setStartDate] = useState(eventDate);
  const [endDate, setEndDate] = useState(eventDate);
  const [location, setLocation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ projectName: string | null; startDate: string; endDate: string }[] | null>(null);

  async function submit(force: boolean) {
    if (!inventoryItemId) { setError("Pick an item to reserve"); return; }
    setPending(true);
    setError(null);
    try {
      const result = await createReservationAction({
        projectId,
        inventoryItemId: Number(inventoryItemId),
        qty: parseFloat(qty) || 1,
        startDate,
        endDate,
        location,
        force,
      });
      if (result.conflict) {
        setConflict(result.conflicts ?? []);
        return;
      }
      setConflict(null);
      setInventoryItemId("");
      setLocation("");
      window.location.reload();
    } catch (e: any) {
      setError(e.message ?? "Couldn't reserve this item");
    } finally {
      setPending(false);
    }
  }

  async function cancel(id: number) {
    if (!confirm("Cancel this reservation? The item goes back to In Store if nothing else has it booked.")) return;
    try {
      await cancelReservationAction(id);
      window.location.reload();
    } catch (e: any) {
      alert(e.message ?? "Couldn't cancel");
    }
  }

  const availableOptions = inventoryOptions.filter((o) => o.status === "in_store" || o.status === "reserved");

  return (
    <div className="space-y-4">
      {reservations.length > 0 && (
        <div className="space-y-2">
          {reservations.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-[var(--color-ink-100)] px-3 py-2 text-[13px]">
              <div>
                <div className="font-medium">
                  {r.itemName} — {r.label}
                  {r.location && <span className="ml-2 inline-block rounded-full bg-[var(--color-accent-50)] text-[var(--color-accent-700)] text-[10.5px] font-medium px-2 py-0.5 align-middle">{r.location}</span>}
                </div>
                <div className="text-[11.5px] text-[var(--color-ink-400)] flex items-center gap-1.5">
                  <span>{r.qty}× · {r.startDate} → {r.endDate}</span>
                  {r.status === "quoted" ? (
                    <span className="inline-block rounded-full bg-amber-50 text-amber-700 text-[10.5px] font-medium px-2 py-0.5">Quoted — provisional</span>
                  ) : (
                    <span>· {r.status}</span>
                  )}
                </div>
              </div>
              {r.status !== "cancelled" && (
                <button onClick={() => cancel(r.id)} className="text-[12px] text-[var(--color-bad)] hover:underline">Cancel</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 space-y-2.5">
        <div className="text-[12px] font-medium text-[var(--color-ink-600)]">Reserve an item</div>
        <select
          value={inventoryItemId}
          onChange={(e) => setInventoryItemId(e.target.value ? Number(e.target.value) : "")}
          className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]"
        >
          <option value="">Select inventory item…</option>
          {availableOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.itemName} — {o.label}</option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-2">
          <input type="number" min="0.01" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)}
            className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" placeholder="Qty" />
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
        </div>
        <input type="text" value={location} onChange={(e) => setLocation(e.target.value)}
          placeholder="Location at venue (optional) — e.g. Main Arena"
          className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />

        {error && <div className="text-[12px] text-[var(--color-bad)]">{error}</div>}

        {conflict && (
          <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2.5 text-[12.5px] text-[var(--color-bad)] space-y-2">
            <div className="font-medium">Already booked on overlapping dates:</div>
            <ul className="list-disc list-inside">
              {conflict.map((c, i) => <li key={i}>{c.projectName ?? "Another project"} — {c.startDate} → {c.endDate}</li>)}
            </ul>
            <button
              disabled={pending}
              onClick={() => submit(true)}
              className="text-[12px] font-medium underline disabled:opacity-50"
            >
              Book anyway
            </button>
          </div>
        )}

        <button
          disabled={pending}
          onClick={() => submit(false)}
          className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[13px] font-medium px-4 py-2 transition-colors disabled:opacity-50"
        >
          {pending ? "Checking…" : "Reserve"}
        </button>
      </div>
    </div>
  );
}
