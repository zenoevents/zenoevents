import Link from "next/link";
import { requirePerm } from "@/lib/guard";
import { listInventoryInstances } from "@/lib/inventory-instances";
import { PageHeader, PrimaryLink, EmptyState, Th, Td, TableCard } from "@/components/ui";
import { CsvImporter } from "@/components/CsvImporter";

export const dynamic = "force-dynamic";

const statusStyles: Record<string, string> = {
  in_store: "bg-emerald-50 text-emerald-700",
  reserved: "bg-blue-50 text-blue-700",
  dispatched: "bg-amber-50 text-amber-700",
  at_event: "bg-violet-50 text-violet-700",
  returned: "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]",
  damaged: "bg-red-50 text-red-700",
  on_external_hire: "bg-orange-50 text-orange-700",
};

const statusLabels: Record<string, string> = {
  in_store: "In store",
  reserved: "Reserved",
  dispatched: "Dispatched",
  at_event: "At event",
  returned: "Returned",
  damaged: "Damaged",
  on_external_hire: "On external hire",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusStyles[status] ?? statusStyles.in_store}`}>
      {statusLabels[status] ?? status}
    </span>
  );
}

export default async function InventoryInstancesPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  await requirePerm("projects");
  const { item: itemParam } = await searchParams;
  const itemId = itemParam && /^\d+$/.test(itemParam) ? Number(itemParam) : null;
  const allRows = await listInventoryInstances();
  const rows = itemId ? allRows.filter((r) => r.itemId === itemId) : allRows;
  const filteredItemName = itemId ? rows[0]?.itemName ?? null : null;

  return (
    <>
      <PageHeader
        title="Event Inventory"
        subtitle="Durable, rentable gear tracked by unit or labeled batch — where it is, not just how many."
        action={
          <div className="flex items-center gap-2">
            <Link href="/projects/inventory/hire" className="rounded-lg border border-[var(--color-ink-200)] bg-white hover:bg-[var(--color-ink-50)] text-[13px] font-medium px-4 py-2 h-9 inline-flex items-center justify-center">
              Hire Out
            </Link>
            <CsvImporter entity="inventory" label="Bulk import inventory" />
            <PrimaryLink href="/projects/inventory/new">+ New item</PrimaryLink>
          </div>
        }
      />
      {itemId && (
        <div className="mb-4 flex items-center gap-2 text-[13px]">
          <span className="text-[var(--color-ink-500)]">Showing only{filteredItemName ? ` "${filteredItemName}"` : ""}</span>
          <Link href="/projects/inventory" className="text-[var(--color-accent-600)] font-medium hover:underline">Clear filter</Link>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState
          title="No tracked inventory yet"
          body="Register the chairs, tents, and AV gear you rent out as labeled units or batches — then reserve them against a project's dates and get a hard warning if two events want the same set at once."
          action={<PrimaryLink href="/projects/inventory/new">+ New item</PrimaryLink>}
        />
      ) : (
        <TableCard>
          <thead>
            <tr className="hairline-b">
              <Th>Catalog item</Th>
              <Th>Label</Th>
              <Th right>Qty</Th>
              <Th>Condition</Th>
              <Th>Status</Th>
              <Th>Warehouse</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hairline-t hover:bg-[var(--color-ink-50)]">
                <Td className="font-medium">{r.itemName}</Td>
                <Td>{r.label}</Td>
                <Td right>{r.qty}</Td>
                <Td className="capitalize">{r.condition}</Td>
                <Td><StatusBadge status={r.status} /></Td>
                <Td>{r.warehouseName ?? <span className="text-[var(--color-ink-300)]">—</span>}</Td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
    </>
  );
}
