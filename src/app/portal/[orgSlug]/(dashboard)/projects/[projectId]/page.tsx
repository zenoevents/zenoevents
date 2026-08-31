import { getClientSession } from "@/lib/client-portal/auth";
import {
  getClientProject,
  getClientPaymentSchedule,
  getClientProjectDocuments,
  getClientProjectContracts,
  getClientProjectTimeline,
} from "@/lib/client-portal/projects";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, StatusPill, Money } from "@/components/ui";
import { milestoneAmountCents } from "@/lib/milestone-amount";
import { ContractAcceptButtons } from "./ContractAcceptButtons";

export const dynamic = "force-dynamic";

const TRIGGER_LABELS: Record<string, string> = {
  fixed_date: "Due on a fixed date",
  days_before_event: "Due before the event",
  on_confirmation: "Due on booking confirmation",
};

export default async function ClientPortalProjectDetail({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId: projectIdParam } = await params;
  const projectId = Number(projectIdParam);
  const session = await getClientSession(orgSlug);
  if (!session) redirect(`/portal/${orgSlug}/login`);
  if (!Number.isFinite(projectId)) notFound();

  const project = await getClientProject(session.orgId, session.contactId, projectId);
  if (!project) notFound();

  const [schedule, docs, contracts, timeline] = await Promise.all([
    getClientPaymentSchedule(session.orgId, projectId),
    getClientProjectDocuments(session.orgId, session.contactId, projectId),
    getClientProjectContracts(session.orgId, projectId),
    getClientProjectTimeline(session.orgId, projectId),
  ]);

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={`${project.eventType || "Event"}${project.venue ? ` · ${project.venue}` : ""} · ${project.eventDate}`}
        action={
          <div className="flex items-center gap-3">
            <StatusPill status={project.status} />
            <Link href={`/portal/${orgSlug}/projects`} className="text-[13px] text-[var(--color-brand)] font-medium hover:underline">← All projects</Link>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-5xl">
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-4">
            <div className="text-[13px] font-semibold text-[var(--color-ink-600)] mb-3">Timeline</div>
            {timeline.length === 0 ? (
              <div className="text-[13px] text-[var(--color-ink-400)]">Nothing yet.</div>
            ) : (
              <ul className="space-y-2.5">
                {timeline.map((t, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[13px]">
                    <span>{t.icon}</span>
                    <div>
                      <div>{t.label}</div>
                      <div className="text-[11.5px] text-[var(--color-ink-400)]">{t.date}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-4">
            <div className="text-[13px] font-semibold text-[var(--color-ink-600)] mb-3">Payment schedule</div>
            {schedule.length === 0 ? (
              <div className="text-[13px] text-[var(--color-ink-400)]">No payment schedule set up yet.</div>
            ) : (
              <div className="space-y-3">
                {schedule.map((m) => {
                  const amount = milestoneAmountCents(m, project.budgetCents);
                  return (
                    <div key={m.id} className="flex items-center justify-between text-[13px] border-b border-[var(--color-ink-100)] pb-2.5 last:border-0 last:pb-0">
                      <div>
                        <div className="font-medium">{m.milestoneName}</div>
                        <div className="text-[11.5px] text-[var(--color-ink-400)]">
                          {m.amountType === "percentage" ? `${m.percentageValue}% of total` : "Fixed amount"}
                          {m.docNumber ? ` · ${m.docNumber}` : ""}
                        </div>
                      </div>
                      <div className="text-right">
                        <Money cents={amount} className="font-semibold" />
                        <div className="text-[11px] mt-0.5">
                          {m.docStatus ? (
                            (m.docPaidCents ?? 0) >= (m.docTotalCents ?? 0) && (m.docTotalCents ?? 0) > 0 ? (
                              <span className="text-emerald-700 font-medium">Paid</span>
                            ) : (
                              <span className="text-amber-700 font-medium">Awaiting payment</span>
                            )
                          ) : (
                            <span className="text-[var(--color-ink-400)]">Not yet invoiced</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card p-4">
            <div className="text-[13px] font-semibold text-[var(--color-ink-600)] mb-3">Invoices & quotes</div>
            {docs.length === 0 ? (
              <div className="text-[13px] text-[var(--color-ink-400)]">Nothing raised for this project yet.</div>
            ) : (
              <div className="space-y-2">
                {docs.map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-[13px]">
                    <div className="flex items-center gap-2">
                      <a href={`/portal/${orgSlug}/api/pdf/${d.id}`} target="_blank" rel="noreferrer" className="font-medium hover:text-[var(--color-brand)] hover:underline">
                        {d.number}
                      </a>
                      <StatusPill status={d.status} />
                    </div>
                    <Money cents={d.totalCents} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <div className="text-[13px] font-semibold text-[var(--color-ink-600)] mb-3">Contracts</div>
            {contracts.length === 0 ? (
              <div className="text-[13px] text-[var(--color-ink-400)]">No contracts yet.</div>
            ) : (
              <div className="space-y-3">
                {contracts.map((c) => (
                  <div key={c.id} className="border border-[var(--color-ink-100)] rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12.5px] font-medium">{c.subject}</div>
                      <StatusPill status={c.status} />
                    </div>
                    <a href={`/portal/${orgSlug}/api/pdf/contract/${c.id}`} target="_blank" rel="noreferrer" className="text-[11.5px] text-[var(--color-brand)] font-medium hover:underline mt-1 inline-block">
                      View PDF
                    </a>
                    {(c.status === "draft" || c.status === "sent") && (
                      <ContractAcceptButtons orgSlug={orgSlug} contractId={c.id} />
                    )}
                    {c.status === "signed" && c.signedAt && (
                      <div className="text-[11px] text-emerald-700 mt-1.5">Signed {c.signedAt.slice(0, 10)}{c.signedByName ? ` by ${c.signedByName}` : ""}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
