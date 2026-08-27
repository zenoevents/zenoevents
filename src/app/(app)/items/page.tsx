import { withOrg } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { getOrg } from "@/lib/org";
import { getAccess } from "@/lib/access";
import { db, items } from "@/db";
import { eq, and } from "drizzle-orm";
import { stockOnHand, stockValueCents } from "@/lib/inventory";
import { countInventoryInstancesByItem } from "@/lib/inventory-instances";
import { PageHeader, PrimaryLink, EmptyState } from "@/components/ui";
import { CsvImporter } from "@/components/CsvImporter";
import { ItemsTable } from "@/components/ItemsTable";
import { ReportChart } from "@/components/ReportCharts";
import { listItemGroups } from "@/lib/item-groups";

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  await requirePerm("items");
  const o = await getOrg();
  const access = await getAccess();
  const isAdmin = !!access && (access.isOwner || access.role === "admin");
  const canSeeStockCharts = !!access && (access.isOwner || access.role === "admin" || access.role === "accountant");
  const rows = await db.select().from(items).where(and(eq(items.orgId, o.id), eq(items.archived, false)));
  const groups = await listItemGroups();
  const groupNames = Object.fromEntries(groups.map((g) => [g.id, g.name]));
  const rentalUnitCounts = await withOrg(() => countInventoryInstancesByItem());
  const stock: Record<number, { qty: number; value: number }> = {};
  await Promise.all(
    rows
      .filter((it) => it.trackInventory)
      .map(async (it) => {
        stock[it.id] = { qty: await withOrg(() => stockOnHand(it.id)), value: await withOrg(() => stockValueCents(it.id)) };
      })
  );

  return (
    <>
      <PageHeader
        title="Items & Stock"
        subtitle="Products and services · stock valued at FIFO cost"
        action={
          <div className="flex items-start gap-2">
            {isAdmin && <PrimaryLink href="/items/types">Item types</PrimaryLink>}
            <PrimaryLink href="/items/groups">Item groups</PrimaryLink>
            <CsvImporter entity="items" label="Bulk import items" />
            <PrimaryLink href="/items/new">+ New item</PrimaryLink>
          </div>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No items yet"
          body="Add the products you sell or services you offer. Tracked goods get FIFO stock control with reorder alerts."
          action={
          <div className="flex items-start gap-2">
            {isAdmin && <PrimaryLink href="/items/types">Item types</PrimaryLink>}
            <PrimaryLink href="/items/groups">Item groups</PrimaryLink>
            <CsvImporter entity="items" label="Bulk import items" />
            <PrimaryLink href="/items/new">+ New item</PrimaryLink>
          </div>
        }
        />
      ) : (
        <>
          {canSeeStockCharts && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <ReportChart
                title="Stock value by item"
                kind="bar"
                data={rows
                  .filter((it) => it.trackInventory && (stock[it.id]?.value ?? 0) > 0)
                  .sort((a, b) => (stock[b.id]?.value ?? 0) - (stock[a.id]?.value ?? 0))
                  .slice(0, 8)
                  .map((it) => ({ name: it.name, value: (stock[it.id]?.value ?? 0) / 100 }))}
              />
              <ReportChart
                title="Units on hand"
                kind="bar"
                money={false}
                data={rows
                  .filter((it) => it.trackInventory && (stock[it.id]?.qty ?? 0) > 0)
                  .sort((a, b) => (stock[b.id]?.qty ?? 0) - (stock[a.id]?.qty ?? 0))
                  .slice(0, 8)
                  .map((it) => ({ name: it.name, value: stock[it.id]?.qty ?? 0 }))}
              />
            </div>
          )}
          <ItemsTable
            rows={rows}
            stock={stock}
            groupNames={groupNames}
            groupsRequired={o.itemGroupsEnabled}
            groups={groups.map((g) => ({ id: g.id, name: g.name }))}
            rentalUnitCounts={rentalUnitCounts}
          />
        </>
      )}
    </>
  );
}
