import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/guard";
import { getOrg } from "@/lib/org";
import { saveItem } from "@/lib/actions";
import { parseKES } from "@/lib/money";
import { TAX_CLASSES } from "@/lib/tax";
import { PageHeader } from "@/components/ui";
import { listItemGroups } from "@/lib/item-groups";
import { listItemTypes } from "@/lib/item-types";
import { ItemKindGroupFields } from "@/components/ItemKindGroupFields";
import Link from "next/link";
import { db, accounts } from "@/db";
import { and, eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

const input =
  "w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-100)] mt-1";
const label = "text-[12px] font-medium text-[var(--color-ink-600)]";

export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  await requirePerm("items");
  const { returnTo } = await searchParams;
  // Only ever an internal path (set by our own "add the item you're missing"
  // links, e.g. from Event Inventory's New item page) — never trust an
  // external redirect target from a query param.
  const safeReturnTo = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/items";
  const [o, groups, types] = await Promise.all([getOrg(), listItemGroups(), listItemTypes()]);
  const expenseAccounts = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.orgId, o.id), inArray(accounts.type, ["expense"]), eq(accounts.archived, false)))
    .orderBy(accounts.code);
  const groupsRequired = o.itemGroupsEnabled;
  const noGroupsYetWarning = groupsRequired && groups.length === 0;
  async function create(formData: FormData) {
    "use server";
    await saveItem({
      kind: String(formData.get("kind") || "service"),
      itemGroupId: formData.get("itemGroupId") ? Number(formData.get("itemGroupId")) : null,
      name: String(formData.get("name") || "").trim(),
      sku: String(formData.get("sku") || "") || undefined,
      unit: String(formData.get("unit") || "unit"),
      salePriceCents: parseKES(String(formData.get("salePrice") || "0")) || 0,
      purchaseCostCents: parseKES(String(formData.get("purchaseCost") || "0")) || 0,
      taxClass: String(formData.get("taxClass") || "B16"),
      trackInventory: formData.get("trackInventory") === "on",
      reorderLevel: Number(formData.get("reorderLevel") || 0),
      openingQty: Number(formData.get("openingQty") || 0),
      openingUnitCostCents: parseKES(String(formData.get("openingCost") || "0")) || 0,
      measurementType: (formData.get("measurementType") || null) as "length" | "area" | null,
      purchaseAccountId: formData.get("purchaseAccountId") ? Number(formData.get("purchaseAccountId")) : null,
    });
    redirect(safeReturnTo);
  }

  return (
    <>
      <PageHeader title="New item" />
      <form action={create} className="card p-6 max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-4">
        {noGroupsYetWarning && (
          <div className="col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
            No item groups exist yet, and this org requires one for types that need it.{" "}
            <Link href="/items/groups" className="font-medium underline">
              Create an item group
            </Link>
            , or pick a type that doesn't require one.
          </div>
        )}
        <ItemKindGroupFields
          types={types}
          groups={groups.map((g) => ({ id: g.id, name: g.name, appliesTo: g.appliesTo }))}
          orgGroupsEnabled={groupsRequired}
        />
        <label className="block">
          <span className={label}>Name *</span>
          <input name="name" required className={input} />
        </label>
        <label className="block">
          <span className={label}>SKU / code</span>
          <input name="sku" className={input} />
        </label>
        <label className="block">
          <span className={label}>Unit</span>
          <input name="unit" defaultValue="unit" className={input} placeholder="pc, kg, hour…" />
        </label>
        <label className="block">
          <span className={label}>Measured by</span>
          <select name="measurementType" className={input} defaultValue="">
            <option value="">Plain count (default)</option>
            <option value="length">Length — one number, e.g. meters off a roll</option>
            <option value="area">Area — width × height entered separately</option>
          </select>
        </label>
        <label className="block">
          <span className={label}>Selling price (KSh)</span>
          <input name="salePrice" className={input} placeholder="0.00" />
        </label>
        <label className="block">
          <span className={label}>Buying cost (KSh)</span>
          <input name="purchaseCost" className={input} placeholder="0.00" />
        </label>
        <label className="block col-span-2">
          <span className={label}>Default category on bills/expenses/POs</span>
          <select name="purchaseAccountId" className={input} defaultValue="">
            <option value="">No default — pick it on each line</option>
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
            ))}
          </select>
          <p className="text-[11px] text-[var(--color-ink-400)] mt-1">
            Auto-fills the category whenever this item is picked on a bill, expense, or purchase order — skip if this item's cost varies by category.
          </p>
        </label>
        <label className="block col-span-2">
          <span className={label}>VAT treatment</span>
          <select name="taxClass" className={input}>
            {Object.entries(TAX_CLASSES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <div className="col-span-2 hairline-t pt-4">
          <label className="flex items-center gap-2 text-[13px] font-medium">
            <input type="checkbox" name="trackInventory" className="accent-[var(--color-accent-500)]" />
            Track stock for this item (FIFO costing)
          </label>
          <div className="grid grid-cols-3 gap-4 mt-3">
            <label className="block">
              <span className={label}>Opening stock (qty)</span>
              <input name="openingQty" className={input} placeholder="0" />
            </label>
            <label className="block">
              <span className={label}>Opening cost / unit (KSh)</span>
              <input name="openingCost" className={input} placeholder="0.00" />
            </label>
            <label className="block">
              <span className={label}>Reorder alert at</span>
              <input name="reorderLevel" className={input} placeholder="10" />
            </label>
          </div>
        </div>
        <div className="col-span-2 flex gap-3 pt-1">
          <button className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-60 text-white text-[13px] font-medium px-5 py-2.5">
            Save item
          </button>
          <a href={safeReturnTo} className="text-[13px] text-[var(--color-ink-400)] self-center">Cancel</a>
        </div>
      </form>
    </>
  );
}
