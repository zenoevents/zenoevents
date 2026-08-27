import { requirePerm } from "@/lib/guard";
import { createInventoryInstanceAction, listCatalogItems } from "@/lib/inventory-instances";
import { listWarehouses } from "@/lib/warehouses";
import { PageHeader, PrimaryButton } from "@/components/ui";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const input =
  "w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-100)] mt-1";
const label = "text-[12px] font-medium text-[var(--color-ink-600)]";

export default async function NewInventoryInstancePage() {
  await requirePerm("projects");
  const [catalogItems, warehouses] = await Promise.all([listCatalogItems(), listWarehouses()]);

  async function submit(formData: FormData) {
    "use server";
    await createInventoryInstanceAction(formData);
    redirect("/projects/inventory");
  }

  return (
    <>
      <PageHeader title="New inventory item" subtitle="A unit or a labeled batch — one row you'll reserve, dispatch, and return as a whole." />
      <form action={submit} className="card p-6 max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block col-span-2">
          <span className={label}>Catalog item</span>
          <select name="itemId" required defaultValue="" className={input}>
            <option value="" disabled>Select an item…</option>
            {catalogItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          {catalogItems.length === 0 ? (
            <p className="text-[11px] text-[var(--color-bad)] mt-1">
              No catalog items yet —{" "}
              <a href="/items/new?returnTo=/projects/inventory/new" className="underline font-medium">
                create one now
              </a>{" "}
              (e.g. "Chiavari Chair"), you'll land right back here.
            </p>
          ) : (
            <a href="/items/new?returnTo=/projects/inventory/new" className="inline-block text-[11.5px] text-[var(--color-accent-600)] hover:underline mt-1">
              + New catalog item
            </a>
          )}
        </label>

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

        <div className="col-span-2 pt-1">
          <PrimaryButton className="px-5 py-2.5">Add to inventory</PrimaryButton>
        </div>
      </form>
    </>
  );
}
