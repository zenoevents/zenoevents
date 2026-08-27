import { requirePerm } from "@/lib/guard";
import { listCatalogItems } from "@/lib/inventory-instances";
import { listWarehouses } from "@/lib/warehouses";
import { listItemGroups } from "@/lib/item-groups";
import { listItemTypes } from "@/lib/item-types";
import { getOrg } from "@/lib/org";
import { PageHeader } from "@/components/ui";
import { NewInventoryItemForm } from "./NewInventoryItemForm";
import { db, accounts } from "@/db";
import { and, eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function NewInventoryInstancePage() {
  await requirePerm("projects");
  const [catalogItems, warehouses, groups, types, o] = await Promise.all([
    listCatalogItems(),
    listWarehouses(),
    listItemGroups(),
    listItemTypes(),
    getOrg(),
  ]);
  const expenseAccounts = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.orgId, o.id), inArray(accounts.type, ["expense"]), eq(accounts.archived, false)))
    .orderBy(accounts.code);

  return (
    <>
      <PageHeader title="New inventory item" subtitle="Pick from the catalog, or create a brand-new one — either way you'll end up with a batch you can reserve, dispatch, and return." />
      <NewInventoryItemForm
        catalogItems={catalogItems}
        warehouses={warehouses}
        types={types}
        groups={groups.map((g) => ({ id: g.id, name: g.name, appliesTo: g.appliesTo }))}
        groupsRequired={o.itemGroupsEnabled}
        expenseAccounts={expenseAccounts}
      />
      <a href="/items/new?returnTo=/projects/inventory/new" className="inline-block mt-3 text-[12px] text-[var(--color-ink-400)] hover:underline">
        Need SKU, description, or more control? Use the full Items &amp; Stock form →
      </a>
    </>
  );
}
