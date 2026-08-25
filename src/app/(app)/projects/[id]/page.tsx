import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/guard";
import { getProject, projectFinancials, projectDocuments } from "@/lib/projects";
import { listInventoryInstances, listReservationsForProject } from "@/lib/inventory-instances";
import { PageHeader, PrimaryLink, StatCard, Money, StatusPill, EmptyState, Th, Td, TableCard } from "@/components/ui";
import { ProjectStatusControl } from "./ProjectStatusControl";
import { ReserveInventoryPanel } from "./ReserveInventoryPanel";
import type { ProjectStatus } from "@/lib/project-status";

export const dynamic = "force-dynamic";

const docTypeLabels: Record<string, string> = {
  quote: "Quote",
  invoice: "Invoice",
  bill: "Bill",
  expense: "Expense",
  credit_note: "Credit note",
};

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("projects");
  const { id } = await params;
  const projectId = Number(id);
  const project = await getProject(projectId);
  if (!project) notFound();

  const [financials, docs, inventoryOptions, itemReservations] = await Promise.all([
    projectFinancials(projectId),
    projectDocuments(projectId),
    listInventoryInstances(),
    listReservationsForProject(projectId),
  ]);

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={[project.eventType, project.venue, project.eventDate].filter(Boolean).join(" · ")}
        action={
          <div className="flex items-center gap-2">
            <ProjectStatusControl id={project.id} status={project.status as ProjectStatus} />
            <PrimaryLink href={`/projects/${project.id}/edit`}>Edit</PrimaryLink>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <StatCard label="Budget" cents={financials.budgetCents} />
        <StatCard label="Invoiced" cents={financials.invoicedCents} />
        <StatCard label="Collected" cents={financials.collectedCents} tone="good" />
        <StatCard label="Cost so far" cents={financials.costCents} tone={financials.costCents > financials.budgetCents && financials.budgetCents > 0 ? "bad" : "neutral"} />
        <StatCard label="Margin" cents={financials.marginCents} tone={financials.marginCents >= 0 ? "good" : "bad"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div>
            <div className="text-[13px] font-semibold mb-2">Invoices, bills &amp; expenses</div>
            {docs.length === 0 ? (
              <EmptyState
                title="Nothing raised against this project yet"
                body="Invoices, bills, and expenses tagged to this project will show up here and roll into the numbers above."
              />
            ) : (
              <TableCard>
                <thead>
                  <tr className="hairline-b">
                    <Th>Type</Th>
                    <Th>Number</Th>
                    <Th>Date</Th>
                    <Th>Status</Th>
                    <Th right>Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id} className="hairline-t hover:bg-[var(--color-ink-50)]">
                      <Td>{docTypeLabels[d.type] ?? d.type}</Td>
                      <Td>{d.number}</Td>
                      <Td>{d.date}</Td>
                      <Td><StatusPill status={d.status} docType={d.type} /></Td>
                      <Td right><Money cents={d.totalCents} /></Td>
                    </tr>
                  ))}
                </tbody>
              </TableCard>
            )}
          </div>

          <div>
            <div className="text-[13px] font-semibold mb-2">Inventory reservations</div>
            {inventoryOptions.length === 0 ? (
              <EmptyState
                title="No tracked inventory yet"
                body="Register durable gear (chairs, tents, AV) under Event Inventory first — then reserve it here against this project's dates."
                action={<PrimaryLink href="/projects/inventory/new">+ New inventory item</PrimaryLink>}
              />
            ) : (
              <ReserveInventoryPanel
                projectId={project.id}
                eventDate={project.eventDate}
                inventoryOptions={inventoryOptions}
                reservations={itemReservations}
              />
            )}
            <div className="text-[13px] font-semibold mt-6 mb-2">Damage reports</div>
            <EmptyState
              title="Coming next"
              body="Photo-verified damage reporting lands in the next build phase — this project record is already the hub it'll hang off."
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <div className="text-[12.5px] font-semibold text-[var(--color-ink-600)] mb-3">Client</div>
            {project.contactId ? (
              <div className="text-[13px]">
                <div className="font-medium">{project.clientName}</div>
                {project.clientPhone && <div className="text-[var(--color-ink-400)] mt-0.5">{project.clientPhone}</div>}
                {project.clientEmail && <div className="text-[var(--color-ink-400)]">{project.clientEmail}</div>}
              </div>
            ) : (
              <div className="text-[13px] text-[var(--color-ink-300)]">No client assigned yet</div>
            )}
          </div>

          {project.notes && (
            <div className="card p-5">
              <div className="text-[12.5px] font-semibold text-[var(--color-ink-600)] mb-2">Notes</div>
              <p className="text-[13px] text-[var(--color-ink-600)] whitespace-pre-wrap">{project.notes}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
