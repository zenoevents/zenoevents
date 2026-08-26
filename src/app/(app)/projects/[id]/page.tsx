import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/guard";
import { getProject, projectFinancials, projectDocuments } from "@/lib/projects";
import { listInventoryInstances, listReservationsForProject } from "@/lib/inventory-instances";
import { listPaymentSchedule } from "@/lib/payment-schedule";
import { listDamageReportsForProject } from "@/lib/damage-reports";
import { listContractsForProject } from "@/lib/contracts";
import { PageHeader, PrimaryLink, StatCard, Money, StatusPill, EmptyState, Th, Td, TableCard } from "@/components/ui";
import { ProjectStatusControl } from "./ProjectStatusControl";
import { ReserveInventoryPanel } from "./ReserveInventoryPanel";
import { PaymentSchedulePanel } from "./PaymentSchedulePanel";
import { DamageReportPanel } from "./DamageReportPanel";
import { ContractsPanel } from "./ContractsPanel";
import type { ProjectStatus } from "@/lib/project-status";

export const dynamic = "force-dynamic";

const docTypeLabels: Record<string, string> = {
  quote: "Quote",
  invoice: "Invoice",
  bill: "Bill",
  expense: "Expense",
  credit_note: "Credit note",
};

const TABS = [
  { key: "overview", label: "Overview", icon: "🏠" },
  { key: "reservations", label: "Reservations", icon: "📦" },
  { key: "payments", label: "Payment Schedule", icon: "💳" },
  { key: "damage", label: "Damage Reports", icon: "⚠️" },
  { key: "contracts", label: "Contracts", icon: "📜" },
] as const;

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePerm("projects");
  const { id } = await params;
  const projectId = Number(id);
  const project = await getProject(projectId);
  if (!project) notFound();

  const { tab: tabParam } = await searchParams;
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam! : "overview";

  const [financials, docs, inventoryOptions, itemReservations, milestones, damageReports, contracts] = await Promise.all([
    projectFinancials(projectId),
    projectDocuments(projectId),
    listInventoryInstances(),
    listReservationsForProject(projectId),
    listPaymentSchedule(projectId),
    listDamageReportsForProject(projectId),
    listContractsForProject(projectId),
  ]);

  const counts = {
    reservations: itemReservations.filter((r) => r.status !== "cancelled").length,
    payments: milestones.length,
    damage: damageReports.length,
    contracts: contracts.length,
  };

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={[project.eventType, project.venue, project.eventDate, project.colorTheme].filter(Boolean).join(" · ")}
        action={
          <div className="flex items-center gap-2">
            <ProjectStatusControl id={project.id} status={project.status as ProjectStatus} />
            <Link href={`/projects/${project.id}/manifest`} className="rounded-lg border border-[var(--color-ink-200)] bg-white hover:bg-[var(--color-ink-50)] text-[13px] font-medium px-4 py-2 transition-colors">Manifest</Link>
            <PrimaryLink href={`/projects/${project.id}/edit`}>Edit</PrimaryLink>
          </div>
        }
      />

      <div className="flex flex-col md:flex-row gap-5 items-start">
        {/* Tabs */}
        <nav className="w-full md:w-[180px] shrink-0 md:sticky md:top-6">
          <ul className="flex md:flex-col gap-1 overflow-x-auto pb-1 md:pb-0">
            {TABS.map((t) => {
              const count = (counts as Record<string, number>)[t.key];
              return (
                <li key={t.key} className="shrink-0">
                  <Link
                    href={`/projects/${projectId}?tab=${t.key}`}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] whitespace-nowrap transition-colors ${
                      tab === t.key
                        ? "bg-white text-[var(--color-accent-700)] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)] border-[0.5px] border-[var(--color-ink-100)]"
                        : "text-[var(--color-ink-600)] hover:bg-white/60"
                    }`}
                  >
                    <span className="opacity-70">{t.icon}</span>
                    {t.label}
                    {count !== undefined && (
                      <span className="ml-auto text-[11px] text-[var(--color-ink-400)] tnum">{count || ""}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Tab content */}
        <div className="flex-1 min-w-0 w-full">
          {tab === "overview" && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
                <StatCard compact label="Budget" cents={financials.budgetCents} />
                <StatCard compact label="Invoiced" cents={financials.invoicedCents} />
                <StatCard compact label="Collected" cents={financials.collectedCents} tone="good" />
                <StatCard compact label="Cost so far" cents={financials.costCents} tone={financials.costCents > financials.budgetCents && financials.budgetCents > 0 ? "bad" : "neutral"} />
                <StatCard compact label="Margin" cents={financials.marginCents} tone={financials.marginCents >= 0 ? "good" : "bad"} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
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

                  {(project.venue || project.colorTheme) && (
                    <div className="card p-5">
                      <div className="text-[12.5px] font-semibold text-[var(--color-ink-600)] mb-3">Event details</div>
                      <div className="text-[13px] space-y-1.5">
                        {project.venue && <div><span className="text-[var(--color-ink-400)]">Venue —</span> {project.venue}</div>}
                        {project.colorTheme && <div><span className="text-[var(--color-ink-400)]">Color theme —</span> {project.colorTheme}</div>}
                      </div>
                    </div>
                  )}

                  {project.notes && (
                    <div className="card p-5">
                      <div className="text-[12.5px] font-semibold text-[var(--color-ink-600)] mb-2">Notes</div>
                      <p className="text-[13px] text-[var(--color-ink-600)] whitespace-pre-wrap">{project.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {tab === "reservations" && (
            inventoryOptions.length === 0 ? (
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
            )
          )}

          {tab === "payments" && (
            <PaymentSchedulePanel
              projectId={project.id}
              budgetCents={financials.budgetCents}
              hasClient={!!project.contactId}
              milestones={milestones}
            />
          )}

          {tab === "damage" && (
            inventoryOptions.length === 0 ? (
              <EmptyState
                title="No tracked inventory yet"
                body="Damage reports are filed against tracked inventory items — register some under Event Inventory first."
              />
            ) : (
              <DamageReportPanel projectId={project.id} inventoryOptions={inventoryOptions} reports={damageReports} />
            )
          )}

          {tab === "contracts" && (
            <ContractsPanel projectId={project.id} contracts={contracts} />
          )}
        </div>
      </div>
    </>
  );
}
