import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/guard";
import { getOrg } from "@/lib/org";
import { getProject, projectFinancials, projectDocuments, getProjectMilestones, getProjectOverviewStats } from "@/lib/projects";
import { listInventoryInstances, listReservationsForProject } from "@/lib/inventory-instances";
import { listPaymentSchedule } from "@/lib/payment-schedule";
import { listDamageReportsForProject } from "@/lib/damage-reports";
import { listContractsForProject } from "@/lib/contracts";
import { listProjectFiles } from "@/lib/project-files";
import { listProjectTasks, listActiveStaff } from "@/lib/project-tasks";
import { listProjectNotes } from "@/lib/project-notes";
import { NotesPanel } from "./NotesPanel";
import { listProjectAuditLog } from "@/lib/audit";
import { getDamagePhotoUrlAction } from "@/lib/damage-reports";
import { todayISO } from "@/lib/money";
import { PageHeader, PrimaryLink, Money, StatusPill, EmptyState, Th, Td, TableCard } from "@/components/ui";
import { ProjectStatusControl } from "./ProjectStatusControl";
import { LifecycleStepper } from "./overview/LifecycleStepper";
import { FinancialBars } from "./overview/FinancialBars";
import { PaymentTimeline } from "./overview/PaymentTimeline";
import { ManifestReadiness } from "./overview/ManifestReadiness";
import { CostBreakdown } from "./overview/CostBreakdown";
import { DamageFlag } from "./overview/DamageFlag";
import { ReserveInventoryPanel } from "./ReserveInventoryPanel";
import { PaymentSchedulePanel } from "./PaymentSchedulePanel";
import { DamageReportPanel } from "./DamageReportPanel";
import { ContractsPanel } from "./ContractsPanel";
import { FilesPanel } from "./FilesPanel";
import { TasksPanel } from "./TasksPanel";
import { MilestonesPanel } from "./MilestonesPanel";
import { AuditLogPanel } from "./AuditLogPanel";
import type { ProjectStatus } from "@/lib/project-status";

export const dynamic = "force-dynamic";

const docTypeLabels: Record<string, string> = {
  quote: "Quote",
  invoice: "Invoice",
  bill: "Bill",
  expense: "Expense",
  credit_note: "Credit note",
};

function docHref(type: string, id: number) {
  if (type === "quote") return `/sales/quotes/${id}`;
  if (type === "invoice") return `/sales/invoices/${id}`;
  if (type === "bill") return `/purchases/bills/${id}`;
  return `/purchases/expenses/${id}`;
}

const TABS = [
  { key: "overview", label: "Overview", icon: "🏠" },
  { key: "quotes", label: "Quotes", icon: "📝" },
  { key: "invoices", label: "Invoices", icon: "🧾" },
  { key: "expenses", label: "Expenses", icon: "💸" },
  { key: "reservations", label: "Reservations", icon: "📦" },
  { key: "payments", label: "Payment Schedule", icon: "💳" },
  { key: "damage", label: "Damage Reports", icon: "⚠️" },
  { key: "contracts", label: "Contracts", icon: "📜" },
  { key: "files", label: "Files", icon: "🗂️" },
  { key: "notes", label: "Notes", icon: "🗒️" },
  { key: "tasks", label: "Tasks", icon: "✅" },
  { key: "milestones", label: "Milestones", icon: "🚀" },
  { key: "audit", label: "Audit Log", icon: "🕒" },
] as const;

type ProjectDocRow = { id: number; type: string; number: string; status: string; date: string; totalCents: number; isBillable?: boolean; billedDocumentId?: number | null };

function DocTable({ docs, showBillable }: { docs: ProjectDocRow[]; showBillable?: boolean }) {
  return (
    <TableCard>
      <thead>
        <tr className="hairline-b">
          <Th>Number</Th>
          <Th>Date</Th>
          <Th>Status</Th>
          {showBillable && <Th>Billable</Th>}
          <Th right>Total</Th>
        </tr>
      </thead>
      <tbody>
        {docs.map((d) => (
          <tr key={d.id} className="hairline-t hover:bg-[var(--color-ink-50)]">
            <Td>
              <Link href={docHref(d.type, d.id)} className="font-medium hover:text-[var(--color-accent-600)]">{d.number}</Link>
            </Td>
            <Td>{d.date}</Td>
            <Td><StatusPill status={d.status} docType={d.type} /></Td>
            {showBillable && (
              <Td>
                {d.isBillable ? (
                  d.billedDocumentId ? (
                    <Link href={docHref("invoice", d.billedDocumentId)} className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 hover:underline">Billed</Link>
                  ) : (
                    <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-50 text-amber-700">Billable — pending</span>
                  )
                ) : (
                  <span className="text-[var(--color-ink-300)]">—</span>
                )}
              </Td>
            )}
            <Td right><Money cents={d.totalCents} /></Td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}

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
  const [project, org] = await Promise.all([getProject(projectId), getOrg()]);
  if (!project) notFound();

  const { tab: tabParam } = await searchParams;
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam! : "overview";

  const [financials, docs, inventoryOptions, itemReservations, milestones, damageReports, contracts, files, tasks, staff, timelineEvents, auditRows, overviewStats, notes] = await Promise.all([
    projectFinancials(projectId),
    projectDocuments(projectId),
    listInventoryInstances(),
    listReservationsForProject(projectId),
    listPaymentSchedule(projectId),
    listDamageReportsForProject(projectId),
    listContractsForProject(projectId),
    listProjectFiles(projectId),
    listProjectTasks(projectId),
    listActiveStaff(),
    getProjectMilestones(projectId),
    listProjectAuditLog(projectId),
    getProjectOverviewStats(projectId),
    listProjectNotes(projectId),
  ]);

  const mostRecentDamage = damageReports[0] ?? null;
  const damagePhotoSignedUrl = mostRecentDamage?.photoUrl
    ? await getDamagePhotoUrlAction(mostRecentDamage.photoUrl).then((r) => (typeof r === "string" ? r : null))
    : null;

  const daysToEvent = Math.ceil((new Date(project.eventDate).getTime() - new Date(todayISO()).getTime()) / 86400000);

  const quoteDocs = docs.filter((d) => d.type === "quote");
  const invoiceDocs = docs.filter((d) => d.type === "invoice");
  const expenseDocs = docs.filter((d) => d.type === "expense" || d.type === "bill");

  const counts = {
    quotes: quoteDocs.length,
    invoices: invoiceDocs.length,
    expenses: expenseDocs.length,
    reservations: itemReservations.filter((r) => r.status !== "cancelled").length,
    payments: milestones.length,
    damage: damageReports.length,
    files: files.length,
    tasks: tasks.filter((t) => !t.done).length,
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

      {/* Tabs — one horizontal, scrollable pill strip */}
      <nav className="mb-5 -mx-1 overflow-x-auto">
        <ul className="flex items-center gap-1 px-1 pb-1 min-w-max">
          {TABS.map((t) => {
            const count = (counts as Record<string, number>)[t.key];
            return (
              <li key={t.key} className="shrink-0">
                <Link
                  href={`/projects/${projectId}?tab=${t.key}`}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] whitespace-nowrap transition-colors ${
                    tab === t.key
                      ? "bg-white text-[var(--color-accent-700)] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)] border-[0.5px] border-[var(--color-ink-100)]"
                      : "text-[var(--color-ink-600)] hover:bg-white/60"
                  }`}
                >
                  <span className="opacity-70">{t.icon}</span>
                  {t.label}
                  {!!count && (
                    <span className={`text-[11px] tnum ${tab === t.key ? "text-[var(--color-accent-600)]" : "text-[var(--color-ink-400)]"}`}>{count}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Tab content */}
      <div>
        {tab === "overview" && (
          <>
            {!overviewStats.cancelled && Number.isFinite(daysToEvent) && (
              <div className="flex justify-end mb-2">
                <span className="inline-block rounded-full bg-[var(--color-accent-50)] text-[var(--color-accent-700)] text-[11.5px] font-medium px-3 py-1">
                  {daysToEvent > 0 ? `${daysToEvent} days to event` : daysToEvent === 0 ? "Event is today" : `${Math.abs(daysToEvent)} days since event`}
                </span>
              </div>
            )}

            <LifecycleStepper stage={overviewStats.stage} cancelled={overviewStats.cancelled} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <FinancialBars
                budgetCents={financials.budgetCents}
                invoicedCents={financials.invoicedCents}
                collectedCents={financials.collectedCents}
                marginCents={financials.marginCents}
              />
              <PaymentTimeline projectId={projectId} milestones={milestones} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <ManifestReadiness
                projectId={projectId}
                manifestExists={overviewStats.manifestExists}
                pickedCount={overviewStats.pickedCount}
                totalDurable={overviewStats.totalDurable}
                lines={overviewStats.manifestLines}
              />
              <CostBreakdown operationalCents={financials.costCents} damageWriteoffCents={overviewStats.damageWriteoffCents} />
              {mostRecentDamage ? (
                <DamageFlag
                  projectId={projectId}
                  count={damageReports.length}
                  itemName={mostRecentDamage.itemName}
                  damageType={mostRecentDamage.damageType}
                  liabilityStatus={mostRecentDamage.liabilityStatus}
                  photoSignedUrl={damagePhotoSignedUrl}
                />
              ) : (
                <div className="card p-5 flex items-center justify-center text-center">
                  <div className="text-[12.5px] text-[var(--color-ink-300)]">No damage reports</div>
                </div>
              )}
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
                          <Td>
                            <Link href={docHref(d.type, d.id)} className="font-medium hover:text-[var(--color-accent-600)]">{d.number}</Link>
                          </Td>
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

        {tab === "quotes" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[13px] font-semibold">Quotes</div>
              <Link href={`/sales/quotes/new?project=${projectId}${project.contactId ? `&contact=${project.contactId}` : ""}`} className="text-[12.5px] font-medium text-[var(--color-accent-600)] hover:underline">+ New Quote</Link>
            </div>
            {quoteDocs.length === 0 ? (
              <EmptyState title="No quotes yet" body="Quotes created for this event — either from here or tagged to this project from the main Quotes screen — show up here." />
            ) : (
              <DocTable docs={quoteDocs} />
            )}
          </div>
        )}

        {tab === "invoices" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[13px] font-semibold">Invoices</div>
              <Link href={`/sales/invoices/new?project=${projectId}${project.contactId ? `&contact=${project.contactId}` : ""}`} className="text-[12.5px] font-medium text-[var(--color-accent-600)] hover:underline">+ New Invoice</Link>
            </div>
            {invoiceDocs.length === 0 ? (
              <EmptyState title="No invoices yet" body="Invoices tagged to this project — including milestone invoices generated from the Payment Schedule tab — show up here." />
            ) : (
              <DocTable docs={invoiceDocs} />
            )}
          </div>
        )}

        {tab === "expenses" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[13px] font-semibold">Expenses</div>
              <Link href={`/purchases/expenses/new?project=${projectId}`} className="text-[12.5px] font-medium text-[var(--color-accent-600)] hover:underline">+ New Expense</Link>
            </div>
            {expenseDocs.length === 0 ? (
              <EmptyState title="No expenses yet" body="Costs incurred for this event — tag an expense to this project when you create it, and it rolls into Cost so far above." />
            ) : (
              <DocTable docs={expenseDocs} showBillable />
            )}
          </div>
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
          <ContractsPanel
            projectId={project.id}
            contracts={contracts}
            contractTemplate={org.contractTemplate}
            project={{
              name: project.name,
              clientName: project.clientName,
              eventDate: project.eventDate,
              venue: project.venue,
              colorTheme: project.colorTheme,
              budgetCents: project.budgetCents,
            }}
            orgName={org.name}
          />
        )}

        {tab === "files" && (
          <FilesPanel projectId={project.id} files={files} />
        )}

        {tab === "notes" && (
          <NotesPanel projectId={project.id} notes={notes} />
        )}

        {tab === "tasks" && (
          <TasksPanel projectId={project.id} tasks={tasks} staff={staff} />
        )}

        {tab === "milestones" && (
          <MilestonesPanel events={timelineEvents} />
        )}

        {tab === "audit" && (
          <AuditLogPanel rows={auditRows} />
        )}
      </div>
    </>
  );
}
