import Link from "next/link";
import { requirePerm } from "@/lib/guard";
import { listProjects } from "@/lib/projects";
import { PageHeader, PrimaryLink, Money, EmptyState, Th, Td, TableCard } from "@/components/ui";

export const dynamic = "force-dynamic";

const statusStyles: Record<string, string> = {
  lead: "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]",
  quoted: "bg-blue-50 text-blue-700",
  confirmed: "bg-violet-50 text-violet-700",
  in_progress: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};

const statusLabels: Record<string, string> = {
  lead: "Lead",
  quoted: "Quoted",
  confirmed: "Confirmed",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusStyles[status] ?? statusStyles.lead}`}>
      {statusLabels[status] ?? status}
    </span>
  );
}

export default async function ProjectsPage() {
  await requirePerm("projects");
  const rows = await listProjects();

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Every event, its client, its date, and its budget — in one place."
        action={<PrimaryLink href="/projects/new">+ New project</PrimaryLink>}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No projects yet"
          body="Create your first event as a project — reserve inventory, schedule milestone invoices, and track budget vs. actual, all tied to one record."
          action={<PrimaryLink href="/projects/new">+ New project</PrimaryLink>}
        />
      ) : (
        <TableCard>
          <thead>
            <tr className="hairline-b">
              <Th>Event</Th>
              <Th>Client</Th>
              <Th>Date</Th>
              <Th>Status</Th>
              <Th right>Budget</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="hairline-t hover:bg-[var(--color-ink-50)]">
                <Td>
                  <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  {p.eventType && <div className="text-[11.5px] text-[var(--color-ink-400)]">{p.eventType}{p.venue ? ` · ${p.venue}` : ""}</div>}
                </Td>
                <Td>{p.clientName ?? <span className="text-[var(--color-ink-300)]">No client yet</span>}</Td>
                <Td>{p.eventDate}</Td>
                <Td><StatusBadge status={p.status} /></Td>
                <Td right><Money cents={p.budgetCents} /></Td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
    </>
  );
}
