import { requirePerm } from "@/lib/guard";
import { listInventoryInstances } from "@/lib/inventory-instances";
import { PageHeader, PrimaryLink, EmptyState, Th, Td, TableCard } from "@/components/ui";

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

export default async function InventoryInstancesPage() {
  await requirePerm("projects");
  const rows = await listInventoryInstances();

  return (
    <>
      <PageHeader
        title="Event Inventory"
        subtitle="Durable, rentable gear tracked by unit or labeled batch — where it is, not just how many."
        action={<PrimaryLink href="/projects/inventory/new">+ New item</PrimaryLink>}
      />
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
