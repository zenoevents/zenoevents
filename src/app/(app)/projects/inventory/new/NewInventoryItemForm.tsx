"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createInventoryItemWithCatalogAction } from "@/lib/inventory-instances";
import { ItemKindGroupFields } from "@/components/ItemKindGroupFields";
import { TAX_CLASSES } from "@/lib/tax";

const input =
  "w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-100)] mt-1";
const label = "text-[12px] font-medium text-[var(--color-ink-600)]";

type CatalogItem = { id: number; name: string };
type ItemType = { id: number; name: string; isGroupMandatory: boolean };
type Group = { id: number; name: string; appliesTo: string };
type ExpenseAccount = { id: number; code: string; name: string };
type Warehouse = { id: number; name: string };

export function NewInventoryItemForm({
  catalogItems,
  warehouses,
  types,
  groups,
  groupsRequired,
  expenseAccounts,
}: {
  catalogItems: CatalogItem[];
  warehouses: Warehouse[];
  types: ItemType[];
  groups: Group[];
  groupsRequired: boolean;
  expenseAccounts: ExpenseAccount[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"existing" | "new">(catalogItems.length === 0 ? "new" : "existing");
  // Initial default type's group-mandatory-ness decides whether Billing
  // details starts open — ItemKindGroupFields owns the live "kind" select
  // after that (its own internal state, submitted via its native `name`
  // attribute), so a required group is never hidden behind a collapsed
  // section for whichever type is selected by default.
  const defaultKind = types[0]?.name || "goods";
  const groupRequiredForDefaultKind = groupsRequired && (types.find((t) => t.name === defaultKind)?.isGroupMandatory ?? true);
  const [billingOpen, setBillingOpen] = useState(groupRequiredForDefaultKind);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setError(null);
    formData.set("mode", mode);
    setPending(true);
    try {
      const result = await createInventoryItemWithCatalogAction(formData);
      if ("error" in result) { setError(result.error); return; }
      router.push("/projects/inventory");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={submit} className="card p-6 max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="col-span-2 flex gap-2">
        <button
          type="button"
          onClick={() => setMode("existing")}
          className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${
            mode === "existing" ? "border-[var(--color-accent-500)] bg-[var(--color-accent-50)] text-[var(--color-accent-700)]" : "border-[var(--color-ink-200)] text-[var(--color-ink-600)]"
          }`}
        >
          Existing catalog item
        </button>
        <button
          type="button"
          onClick={() => setMode("new")}
          className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${
            mode === "new" ? "border-[var(--color-accent-500)] bg-[var(--color-accent-50)] text-[var(--color-accent-700)]" : "border-[var(--color-ink-200)] text-[var(--color-ink-600)]"
          }`}
        >
          New catalog item
        </button>
      </div>

      {mode === "existing" ? (
        <label className="block col-span-2">
          <span className={label}>Catalog item</span>
          <select name="itemId" required defaultValue="" className={input}>
            <option value="" disabled>Select an item…</option>
            {catalogItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          {catalogItems.length === 0 && (
            <p className="text-[11px] text-[var(--color-ink-400)] mt-1">No catalog items yet — switch to "New catalog item" above.</p>
          )}
        </label>
      ) : (
        <>
          <label className="block col-span-2">
            <span className={label}>Name *</span>
            <input name="newItemName" required placeholder="e.g. Chiavari Chair" className={input} />
          </label>

          <button
            type="button"
            onClick={() => setBillingOpen((v) => !v)}
            className="col-span-2 text-left text-[12px] font-medium text-[var(--color-accent-600)] hover:underline -mt-2"
          >
            {billingOpen ? "− Hide billing details" : "+ Billing details (VAT, price, category)"}
          </button>

          {billingOpen && (
            <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-dashed border-[var(--color-ink-200)] p-4">
              <ItemKindGroupFields
                types={types}
                groups={groups}
                orgGroupsEnabled={groupsRequired}
                defaultKind={defaultKind}
              />
              <label className="block">
                <span className={label}>SKU / code</span>
                <input name="sku" className={input} />
              </label>
              <label className="block">
                <span className={label}>Unit</span>
                <input name="unit" defaultValue="unit" className={input} placeholder="pc, set, hour…" />
              </label>
              <label className="block">
                <span className={label}>Selling price (KSh)</span>
                <input name="salePrice" className={input} placeholder="0.00" />
              </label>
              <label className="block">
                <span className={label}>Buying cost (KSh)</span>
                <input name="purchaseCost" className={input} placeholder="0.00" />
              </label>
              <label className="block">
                <span className={label}>VAT treatment</span>
                <select name="taxClass" className={input} defaultValue="B16">
                  {Object.entries(TAX_CLASSES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={label}>Default category on bills/expenses/POs</span>
                <select name="purchaseAccountId" className={input} defaultValue="">
                  <option value="">No default — pick it on each line</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </>
      )}

      <div className="col-span-2 hairline-t" />

      <label className="block">
        <span className={label}>Label</span>
        <input name="label" type="text" required placeholder="e.g. Set B, or a serial number" className={input} />
      </label>

      <label className="block">
        <span className={label}>Quantity in this batch</span>
        <input name="qty" type="number" step="1" min="1" defaultValue="1" className={input} />
        <p className="text-[11px] text-[var(--color-ink-400)] mt-1">1 for a single serialized unit, more for a labeled batch (e.g. "Set B — 40 chairs").</p>
      </label>

      <label className="block col-span-2">
        <span className={label}>Warehouse</span>
        <select name="warehouseId" defaultValue="" className={input}>
          <option value="">Default warehouse</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </label>

      {error && <div className="col-span-2 text-[12.5px] text-[var(--color-bad)]">{error}</div>}

      <div className="col-span-2 pt-1">
        <button disabled={pending} className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-60 text-white text-[13px] font-medium px-5 py-2.5">
          {pending ? "Saving…" : "Add to inventory"}
        </button>
      </div>
    </form>
  );
}
