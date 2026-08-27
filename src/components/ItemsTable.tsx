"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { fmtKES } from "@/lib/money";
import { TAX_CLASSES, type TaxClass } from "@/lib/tax";
import { TableCard, Th, Td } from "@/components/ui";
import { StockAdjust } from "@/components/StockAdjust";
import { assignItemGroupsAction } from "@/lib/item-groups";
import { useRouter } from "next/navigation";

interface ItemRow {
  id: number;
  itemGroupId: number | null;
  name: string;
  sku: string | null;
  kind: string;
  taxClass: string;
  salePriceCents: number;
  unit: string;
  trackInventory: boolean;
  reorderLevel: number;
}

export function ItemsTable({
  rows,
  stock,
  groupNames,
  groupsRequired,
  groups,
  rentalUnitCounts,
}: {
  rows: ItemRow[];
  stock: Record<number, { qty: number; value: number }>;
  groupNames?: Record<number, string>;
  groupsRequired?: boolean;
  groups?: Array<{ id: number; name: string }>;
  rentalUnitCounts?: Record<number, number>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkGroupId, setBulkGroupId] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (it) => it.name.toLowerCase().includes(needle) || (it.sku ?? "").toLowerCase().includes(needle)
    );
  }, [rows, q]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((it) => selectedIds.includes(it.id));
  const ungroupedCount = rows.filter((it) => !it.itemGroupId).length;

  function toggle(id: number) {
    setSelectedIds((curr) => (curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]));
  }

  function toggleAllVisible() {
    setSelectedIds((curr) =>
      allVisibleSelected
        ? curr.filter((id) => !filtered.some((it) => it.id === id))
        : Array.from(new Set([...curr, ...filtered.map((it) => it.id)]))
    );
  }

  function assignSelected() {
    setError(null);
    if (!bulkGroupId) {
      setError("Pick a group");
      return;
    }
    if (!selectedIds.length) {
      setError("Select at least one item");
      return;
    }
    start(async () => {
      try {
        await assignItemGroupsAction(selectedIds, Number(bulkGroupId));
        setSelectedIds([]);
        setBulkGroupId("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Bulk update failed");
      }
    });
  }

  return (
    <>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search items by name or SKU…"
        className="w-full max-w-sm rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-100)] mb-3"
      />
      {groups && groups.length > 0 && (
        <div className="mb-3 rounded-xl border border-[var(--color-ink-200)] bg-white px-4 py-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-[13px] text-[var(--color-ink-600)]">
              {selectedIds.length > 0
                ? `${selectedIds.length} item${selectedIds.length === 1 ? "" : "s"} selected`
                : ungroupedCount > 0
                  ? `${ungroupedCount} item${ungroupedCount === 1 ? "" : "s"} still ungrouped`
                  : "All current items are grouped"}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={bulkGroupId}
                onChange={(e) => setBulkGroupId(e.target.value)}
                className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px]"
              >
                <option value="">Assign selected to group…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={pending}
                onClick={assignSelected}
                className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-50 text-white text-[13px] font-medium px-4 py-2"
              >
                {pending ? "Saving..." : "Assign group"}
              </button>
            </div>
          </div>
          {error && <div className="mt-2 text-[12px] text-[var(--color-bad)]">{error}</div>}
        </div>
      )}
      <TableCard>
        <thead className="hairline-b">
          <tr>
            <Th>
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select visible items" />
            </Th>
            <Th>Item</Th>
            <Th>Group</Th>
            <Th>VAT</Th>
            <Th right>Selling price</Th>
            <Th right>In stock</Th>
            <Th right>Stock value</Th>
            <Th>Adjust</Th>
            <Th>Edit</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((it) => {
            const qty = it.trackInventory ? stock[it.id]?.qty ?? 0 : null;
            const low = qty !== null && it.reorderLevel > 0 && qty <= it.reorderLevel;
            return (
              <tr key={it.id} className="hairline-t">
                <Td>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(it.id)}
                    onChange={() => toggle(it.id)}
                    aria-label={`Select ${it.name}`}
                  />
                </Td>
                <Td>
                  <span className="font-medium">{it.name}</span>
                  {it.sku && <span className="text-[var(--color-ink-400)]"> · {it.sku}</span>}
                  <div className="text-[11px] text-[var(--color-ink-400)] capitalize">{it.kind}</div>
                  {!!rentalUnitCounts?.[it.id] && (
                    <Link
                      href={`/projects/inventory?item=${it.id}`}
                      className="inline-block mt-1 rounded-full bg-[var(--color-accent-50)] text-[var(--color-accent-700)] text-[10.5px] font-medium px-2 py-0.5 hover:underline"
                    >
                      🎪 {rentalUnitCounts[it.id]} rental unit{rentalUnitCounts[it.id] === 1 ? "" : "s"}
                    </Link>
                  )}
                </Td>
                <Td className="text-[var(--color-ink-600)]">
                  {it.itemGroupId && groupNames?.[it.itemGroupId]
                    ? groupNames[it.itemGroupId]
                    : groupsRequired
                      ? <span className="text-[var(--color-bad)]">Missing group</span>
                      : <span className="text-[var(--color-ink-400)]">Ungrouped</span>}
                </Td>
                <Td className="text-[var(--color-ink-600)]">
                  {TAX_CLASSES[it.taxClass as TaxClass]?.label ?? it.taxClass}
                </Td>
                <Td right>{fmtKES(it.salePriceCents)}</Td>
                <Td right>
                  {qty === null ? (
                    <span className="text-[var(--color-ink-400)]">—</span>
                  ) : (
                    <span className={low ? "text-[var(--color-bad)] font-semibold" : ""}>
                      {qty} {it.unit}
                      {low && " ⚠︎"}
                    </span>
                  )}
                </Td>
                <Td right>{it.trackInventory ? fmtKES(stock[it.id]?.value ?? 0) : "—"}</Td>
                <Td>{it.trackInventory && <StockAdjust itemId={it.id} unit={it.unit} />}</Td>
                <Td>
                  <Link href={`/items/${it.id}/edit`} className="text-[var(--color-accent-600)] font-medium hover:underline">
                    Edit
                  </Link>
                </Td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-3 text-[13px] text-[var(--color-ink-400)]">
                No items match &quot;{q}&quot;.
              </td>
            </tr>
          )}
        </tbody>
      </TableCard>
    </>
  );
}
