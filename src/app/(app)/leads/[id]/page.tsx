import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/lib/guard";
import { getOrg } from "@/lib/org";
import { db, members } from "@/db";
import { and, eq } from "drizzle-orm";
import { getLead, assignLeadAction } from "@/lib/leads";
import { PageHeader } from "@/components/ui";
import { StageForm } from "./StageForm";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("leads");
  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isFinite(leadId)) notFound();

  const [lead, o] = await Promise.all([getLead(leadId), getOrg()]);
  if (!lead) notFound();
  const staff = await db.select({ id: members.id, name: members.name, email: members.email })
    .from(members).where(and(eq(members.orgId, o.id), eq(members.active, true)));

  async function assign(formData: FormData) {
    "use server";
    const memberIdRaw = formData.get("memberId") as string;
    await assignLeadAction(leadId, memberIdRaw ? Number(memberIdRaw) : null);
    redirect(`/leads/${leadId}`);
  }

  const details = (lead.details as Record<string, unknown> | null) ?? null;

  return (
    <>
      <PageHeader
        title={lead.name}
        subtitle={`via ${lead.channel}${lead.channelDetail ? ` — ${lead.channelDetail}` : ""} · captured ${new Date(lead.createdAt).toLocaleString()}`}
        action={<Link href="/leads" className="text-[13px] text-[var(--color-accent-600)] font-medium hover:underline">← Back to Leads</Link>}
      />

      {lead.possibleDuplicate && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          Possible duplicate — matches an existing {lead.possibleDuplicate.kind === "contact" ? "customer" : "lead"}:{" "}
          {lead.possibleDuplicate.kind === "contact" ? (
            <Link href={`/contacts/${lead.possibleDuplicate.id}`} className="underline font-medium">{lead.possibleDuplicate.label}</Link>
          ) : (
            <Link href={`/leads/${lead.possibleDuplicate.id}`} className="underline font-medium">{lead.possibleDuplicate.label}</Link>
          )}{" "}
          — same phone number.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-4 space-y-3">
          <div className="text-[13px] font-semibold text-[var(--color-ink-600)]">Details</div>
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div><div className="text-[11px] text-[var(--color-ink-400)]">Phone</div><div>{lead.phone || "—"}</div></div>
            <div><div className="text-[11px] text-[var(--color-ink-400)]">Email</div><div>{lead.email || "—"}</div></div>
            <div><div className="text-[11px] text-[var(--color-ink-400)]">Event type</div><div>{lead.eventType || "—"}</div></div>
            <div><div className="text-[11px] text-[var(--color-ink-400)]">Event date</div><div>{lead.eventDate || "—"}</div></div>
          </div>
          {lead.message && (
            <div>
              <div className="text-[11px] text-[var(--color-ink-400)]">Message</div>
              <div className="text-[13px] whitespace-pre-wrap">{lead.message}</div>
            </div>
          )}
          {details && Object.keys(details).length > 0 && (
            <div>
              <div className="text-[11px] text-[var(--color-ink-400)] mb-1">Additional details</div>
              <div className="grid grid-cols-2 gap-2 text-[13px]">
                {Object.entries(details).map(([k, v]) => (
                  <div key={k}>
                    <span className="text-[var(--color-ink-400)] capitalize">{k.replace(/_/g, " ")}: </span>
                    <span>{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card p-4 space-y-2">
            <div className="text-[13px] font-semibold text-[var(--color-ink-600)]">Assignment</div>
            <form action={assign} className="flex gap-2">
              <select name="memberId" defaultValue={lead.assignedMemberId ?? ""} className="flex-1 rounded-md border border-[var(--color-ink-200)] px-2 py-2 text-[13px] bg-white">
                <option value="">Unassigned</option>
                {staff.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.email}</option>
                ))}
              </select>
              <button className="rounded-md bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[12.5px] font-medium px-3">Set</button>
            </form>
          </div>

          <div className="card p-4 space-y-2">
            <div className="text-[13px] font-semibold text-[var(--color-ink-600)]">Stage</div>
            <StageForm leadId={leadId} currentStage={lead.stage} currentLostReason={lead.lostReason} />
          </div>
        </div>
      </div>
    </>
  );
}
