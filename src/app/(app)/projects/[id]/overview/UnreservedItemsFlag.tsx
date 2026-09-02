import Link from "next/link";

type UnreservedItem = { itemId: number; name: string; qty: number };

/** Flags Event Inventory items on this project's invoices that auto-booking
 *  skipped (split across multiple batches, short on quantity, or a date
 *  conflict) and nobody's manually reserved since — otherwise this is
 *  invisible until someone happens to check the Reservations tab, possibly
 *  not until event day. */
export function UnreservedItemsFlag({ projectId, items }: { projectId: number; items: UnreservedItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 mb-4 flex items-start gap-3">
      <span className="text-[15px] mt-0.5">⚠️</span>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-semibold text-amber-800">
          {items.length === 1 ? "1 item still needs a manual reservation" : `${items.length} items still need a manual reservation`}
        </div>
        <div className="text-[12px] text-amber-700 mt-0.5">
          Billed on the invoice, but not booked — usually because the catalog item splits across more than one batch and the system won't guess which one.
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {items.map((it) => (
            <span key={it.itemId} className="inline-block rounded-full bg-white border border-amber-200 px-2.5 py-0.5 text-[11px] text-amber-800">
              {it.name} · {it.qty}
            </span>
          ))}
        </div>
      </div>
      <Link href={`/projects/${projectId}?tab=reservations`} className="shrink-0 text-[12px] font-medium text-amber-800 hover:underline whitespace-nowrap mt-0.5">
        Reserve now →
      </Link>
    </div>
  );
}
