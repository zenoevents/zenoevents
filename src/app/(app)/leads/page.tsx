import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/guard";
import { listLeads, createLeadAction, leadSlaFlags, sourcePerformance, referralSummary } from "@/lib/leads";
import { LEAD_STAGES, LEAD_STAGE_LABELS } from "@/lib/lead-constants";
import { PageHeader } from "@/components/ui";
import { StackedBarChart } from "@/components/analytics/Charts";
import { fmtKES } from "@/lib/money";

export const dynamic = "force-dynamic";

const CHANNEL_ICON: Record<string, string> = {
  instagram: "📸", facebook: "📘", website: "🌐", whatsapp: "💬", qr: "🔳", manual: "✍️", referral: "🤝",
};

export default async function LeadsPage() {
  await requirePerm("leads");
  const [rows, sla, perf, referrals] = await Promise.all([listLeads(), leadSlaFlags(), sourcePerformance(), referralSummary()]);

  const total = rows.length;
  const open = rows.filter((r) => r.stage !== "won" && r.stage !== "lost").length;
  const won = rows.filter((r) => r.stage === "won").length;
  const winRate = total ? Math.round((won / total) * 100) : 0;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const newThisWeek = rows.filter((r) => r.createdAt >= weekAgo).length;
  const contactedLeads = rows.filter((r) => r.contactedAt);
  const avgResponseHours = contactedLeads.length
    ? Math.round(contactedLeads.reduce((s, r) => s + (new Date(r.contactedAt!).getTime() - new Date(r.createdAt).getTime()) / 3_600_000, 0) / contactedLeads.length)
    : null;

  async function addLead(formData: FormData) {
    "use server";
    await createLeadAction(formData);
    redirect("/leads");
  }

  return (
    <>
      <PageHeader title="Leads" subtitle="Inquiries from every channel, in one pipeline — new through won or lost." />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <KpiTile label="Total leads" value={String(total)} />
        <KpiTile label="Open" value={String(open)} />
        <KpiTile label="Win rate" value={`${winRate}%`} tone={winRate >= 30 ? "good" : undefined} />
        <KpiTile label="New this week" value={String(newThisWeek)} />
        <KpiTile label="Avg. time to contact" value={avgResponseHours === null ? "—" : avgResponseHours < 1 ? "<1h" : `${avgResponseHours}h`} tone={avgResponseHours !== null && avgResponseHours > 2 ? "warn" : undefined} />
        <KpiTile label="Referral rewards owed" value={referrals.earnedUnpaidCount > 0 ? fmtKES(referrals.earnedUnpaidCents) : "—"} tone={referrals.earnedUnpaidCount > 0 ? "warn" : undefined} />
      </div>

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

      {perf.length > 0 && (
        <div className="card p-4 mb-5">
          <div className="text-[13px] font-semibold text-[var(--color-ink-600)] mb-3">Source performance</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] text-[var(--color-ink-400)] hairline-b">
                    <th className="pb-2 font-medium">Source</th>
                    <th className="pb-2 font-medium text-right">Leads</th>
                    <th className="pb-2 font-medium text-right">Contacted</th>
                    <th className="pb-2 font-medium text-right">Quoted</th>
                    <th className="pb-2 font-medium text-right">Won</th>
                  </tr>
                </thead>
                <tbody>
                  {perf.map((p) => (
                    <tr key={p.channel} className="hairline-t">
                      <td className="py-1.5">{p.channel}</td>
                      <td className="py-1.5 text-right tnum">{p.total}</td>
                      <td className="py-1.5 text-right tnum">{p.contactRate}%</td>
                      <td className="py-1.5 text-right tnum">{p.quoteRate}%</td>
                      <td className="py-1.5 text-right tnum font-medium text-emerald-700">{p.winRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <StackedBarChart
              height={220}
              data={perf.map((p) => ({ label: p.channel, ...p.stageCounts }))}
              series={[
                { key: "new", label: "New", color: "#d2d2d7" },
                { key: "contacted", label: "Contacted", color: "#93c5fd" },
                { key: "quote_sent", label: "Quote sent", color: "#fde68a" },
                { key: "won", label: "Won", color: "#6ee7b7" },
                { key: "lost", label: "Lost", color: "#fca5a5" },
              ]}
            />
          </div>
        </div>
      )}

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

function KpiTile({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  const toneClass = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "";
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] text-[var(--color-ink-400)]">{label}</div>
      <div className={`text-[19px] font-semibold tnum mt-0.5 ${toneClass}`}>{value}</div>
    </div>
  );
}
