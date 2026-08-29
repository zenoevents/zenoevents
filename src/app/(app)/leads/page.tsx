import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/guard";
import { listLeads, createLeadAction, leadSlaFlags } from "@/lib/leads";
import { LEAD_STAGES, LEAD_STAGE_LABELS } from "@/lib/lead-constants";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const CHANNEL_ICON: Record<string, string> = {
  instagram: "📸", facebook: "📘", website: "🌐", whatsapp: "💬", qr: "🔳", manual: "✍️", referral: "🤝",
};

export default async function LeadsPage() {
  await requirePerm("leads");
  const [rows, sla] = await Promise.all([listLeads(), leadSlaFlags()]);

  async function addLead(formData: FormData) {
    "use server";
    await createLeadAction(formData);
    redirect("/leads");
  }

  return (
    <>
      <PageHeader title="Leads" subtitle="Inquiries from every channel, in one pipeline — new through won or lost." />

      {sla.length > 0 && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <span className="font-semibold">{sla.length} lead{sla.length > 1 ? "s" : ""}</span> untouched for over 2 hours —{" "}
          {sla.slice(0, 4).map((l, i) => (
            <span key={l.id}>
              {i > 0 && ", "}
              <Link href={`/leads/${l.id}`} className="underline font-medium">{l.name}</Link>
            </span>
          ))}
          {sla.length > 4 && ` +${sla.length - 4} more`}.
        </div>
      )}

      <form action={addLead} className="card p-3 mb-5 flex flex-wrap gap-2 items-center">
        <input type="hidden" name="channel" value="manual" />
        <input name="name" placeholder="Name" required className="w-40 rounded-md border border-[var(--color-ink-200)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
        <input name="phone" placeholder="Phone" className="w-36 rounded-md border border-[var(--color-ink-200)] px-3 py-2 text-[13px] outline-none" />
        <input name="eventType" placeholder="Wedding, corporate…" className="w-40 rounded-md border border-[var(--color-ink-200)] px-3 py-2 text-[13px] outline-none" />
        <input name="eventDate" type="date" className="rounded-md border border-[var(--color-ink-200)] px-3 py-2 text-[13px] outline-none" />
        <input name="message" placeholder="Notes (optional)" className="flex-1 min-w-[160px] rounded-md border border-[var(--color-ink-200)] px-3 py-2 text-[13px] outline-none" />
        <button className="rounded-md bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[13px] font-medium px-4 py-2">
          + Add lead
        </button>
      </form>

      <div className="flex gap-3 items-start overflow-x-auto pb-2 lg:grid lg:grid-cols-5">
        {LEAD_STAGES.map((stage) => {
          const stageLeads = rows.filter((r) => r.stage === stage);
          const overdueIds = new Set(sla.map((s) => s.id));
          return (
            <div key={stage} className="min-h-[120px] w-[220px] shrink-0 lg:w-auto">
              <div className="flex items-baseline justify-between px-1 pb-2">
                <span className="text-[12px] font-semibold text-[var(--color-ink-600)]">{LEAD_STAGE_LABELS[stage]}</span>
                <span className="text-[11px] text-[var(--color-ink-400)] tnum">{stageLeads.length || ""}</span>
              </div>
              <div className="space-y-2">
                {stageLeads.map((l) => (
                  <Link key={l.id} href={`/leads/${l.id}`} className="card px-3 py-2.5 block hover:bg-[var(--color-ink-50)]">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-medium leading-tight">{l.name}</span>
                      <span title={l.channel}>{CHANNEL_ICON[l.channel] ?? "•"}</span>
                    </div>
                    <div className="text-[11px] text-[var(--color-ink-400)] mt-0.5">
                      {l.eventType || "—"}{l.eventDate ? ` · ${l.eventDate}` : ""}
                    </div>
                    <div className="text-[11px] text-[var(--color-ink-400)] mt-1 flex items-center justify-between">
                      <span>{l.assignedMemberName || "Unassigned"}</span>
                      {overdueIds.has(l.id) && <span className="text-amber-600 font-medium">⏱ overdue</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
