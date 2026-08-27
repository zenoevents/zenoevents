import Link from "next/link";
import { fmtKES } from "@/lib/money";

const statusStyles: Record<string, string> = {
  lead: "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]",
  quoted: "bg-blue-50 text-blue-700",
  confirmed: "bg-violet-50 text-violet-700",
  in_progress: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};
const statusLabels: Record<string, string> = {
  lead: "Lead", quoted: "Quoted", confirmed: "Confirmed", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled",
};

const depositStyles: Record<string, string> = {
  none: "bg-[var(--color-ink-100)] text-[var(--color-ink-400)]",
  unbilled: "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]",
  draft: "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]",
  open: "bg-amber-50 text-amber-700",
  partial: "bg-amber-50 text-amber-700",
  paid: "bg-emerald-50 text-emerald-700",
  overdue: "bg-red-50 text-red-700",
};
const depositLabels: Record<string, string> = {
  none: "No schedule", unbilled: "Not yet invoiced", draft: "Draft invoice", open: "Deposit unpaid", partial: "Partly paid", paid: "Deposit paid",
};

type EventRow = {
  id: number;
  name: string;
  venue: string | null;
  eventDate: string;
  status: string;
  clientName: string | null;
  depositStatus: string;
  readiness: { picked: number; total: number } | null;
};

function countdownLabel(eventDate: string, today: string): string {
  const days = Math.round((new Date(eventDate).getTime() - new Date(today).getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days} days`;
}

export function ThisWeeksEvents({ events, today }: { events: EventRow[]; today: string }) {
  return (
    <div>
      <h2 className="text-[15px] font-semibold mb-3">This week&apos;s events</h2>
      {events.length === 0 ? (
        <div className="card px-6 py-8 text-center text-[13px] text-[var(--color-ink-400)]">Nothing on the calendar in the next 7 days.</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {events.map((e) => (
            <Link key={e.id} href={`/projects/${e.id}`} className="card px-4 py-3 min-w-[230px] shrink-0 hover:bg-[var(--color-ink-50)] transition-colors">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-[13.5px] truncate">{e.name}</div>
                <span className="shrink-0 text-[10.5px] font-semibold text-[var(--color-accent-700)] bg-[var(--color-accent-50)] rounded-full px-2 py-0.5">
                  {countdownLabel(e.eventDate, today)}
                </span>
              </div>
              <div className="text-[11.5px] text-[var(--color-ink-400)] mt-1">{e.eventDate}{e.venue ? ` · ${e.venue}` : ""}</div>
              <div className="text-[11.5px] text-[var(--color-ink-500)] mt-0.5">{e.clientName ?? "No client yet"}</div>
              <div className="flex items-center gap-1.5 mt-2">
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium ${statusStyles[e.status] ?? statusStyles.lead}`}>{statusLabels[e.status] ?? e.status}</span>
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium ${depositStyles[e.depositStatus] ?? depositStyles.none}`}>{depositLabels[e.depositStatus] ?? e.depositStatus}</span>
              </div>
              {e.readiness && e.readiness.total > 0 && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[10px] text-[var(--color-ink-400)] mb-0.5">
                    <span>Manifest readiness</span>
                    <span className="tnum">{e.readiness.picked}/{e.readiness.total}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--color-ink-100)] overflow-hidden">
                    <div className="h-full bg-[var(--color-accent-500)]" style={{ width: `${(e.readiness.picked / e.readiness.total) * 100}%` }} />
                  </div>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

type RiskRow = { projectId: number; projectName: string; eventDate: string; milestoneName: string; docStatus: string; docTotalCents: number; docPaidCents: number };

export function UnpaidMilestoneRisks({ risks }: { risks: RiskRow[] }) {
  if (risks.length === 0) return null;
  return (
    <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3">
      <div className="text-[12.5px] font-semibold text-[var(--color-bad)] mb-2">⚠ Unpaid milestones with the event date closing in</div>
      <div className="space-y-1.5">
        {risks.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-[12.5px]">
            <Link href={`/projects/${r.projectId}`} className="hover:underline">
              {r.projectName} — {r.milestoneName} <span className="text-[var(--color-ink-400)]">({r.eventDate})</span>
            </Link>
            <span className="text-[var(--color-bad)] font-medium tnum shrink-0 ml-3">{fmtKES(r.docTotalCents - r.docPaidCents)} owed</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PIPELINE_STAGES = [
  { key: "draft", label: "Draft" },
  { key: "confirmed", label: "Confirmed" },
  { key: "packing", label: "Packing" },
  { key: "loaded", label: "Loaded" },
  { key: "dispatched", label: "Dispatched" },
  { key: "returned", label: "Returned" },
  { key: "inspected", label: "Inspected" },
] as const;

/** One horizontal pipeline bar across every live (non-reconciled) manifest,
 *  org-wide — replaces four flat number cards with a single scan: each
 *  bubble sized/shaded by its count shows where the bottleneck actually is,
 *  which no generic accounting dashboard has a reason to draw. */
export function ManifestPipelineBar({ pendingDamage, stageCounts }: { pendingDamage: number; stageCounts: Record<string, number> }) {
  const maxCount = Math.max(1, ...Object.values(stageCounts));
  const totalLive = Object.values(stageCounts).reduce((s, c) => s + c, 0);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[13px] font-semibold">Manifest pipeline <span className="font-normal text-[var(--color-ink-400)]">— {totalLive} live</span></div>
        <Link href="/projects/damage-reports" className="flex items-center gap-1.5 text-[11.5px] font-medium hover:underline" style={{ color: pendingDamage > 0 ? "var(--color-bad)" : "var(--color-ink-400)" }}>
          ⚠ {pendingDamage} pending damage report{pendingDamage === 1 ? "" : "s"}
        </Link>
      </div>
      <div className="flex items-end justify-between gap-1 overflow-x-auto pb-1">
        {PIPELINE_STAGES.map((s, i) => {
          const count = stageCounts[s.key] ?? 0;
          const intensity = count / maxCount;
          const size = 32 + Math.round(intensity * 22); // 32-54px
          return (
            <div key={s.key} className="flex items-center shrink-0">
              <Link href="/manifests" className="flex flex-col items-center gap-1.5 w-[70px] group">
                <div
                  className="flex items-center justify-center rounded-full font-semibold tnum transition-transform group-hover:scale-105"
                  style={{
                    width: size, height: size,
                    background: count > 0 ? `color-mix(in srgb, var(--color-accent-500) ${20 + intensity * 60}%, white)` : "var(--color-ink-100)",
                    color: count > 0 && intensity > 0.5 ? "white" : "var(--color-ink-600)",
                    fontSize: 13,
                  }}
                >
                  {count}
                </div>
                <div className="text-[10.5px] text-center text-[var(--color-ink-500)] leading-tight">{s.label}</div>
              </Link>
              {i < PIPELINE_STAGES.length - 1 && <div className="w-4 h-[2px] bg-[var(--color-ink-100)] -mt-4" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type DamageFeedRow = { id: number; projectId: number | null; projectName: string | null; itemName: string | null; damageType: string; photoSignedUrl: string | null };

/** Small thumbnail strip — the photo-evidence trust mechanism made visible
 *  on the dashboard instead of buried behind a bare count. */
export function DamageReportsFeed({ reports }: { reports: DamageFeedRow[] }) {
  if (reports.length === 0) return null;
  return (
    <div>
      <h2 className="text-[15px] font-semibold mb-3">Recent damage reports</h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {reports.map((r) => (
          <Link key={r.id} href={r.projectId ? `/projects/${r.projectId}?tab=damage` : "/projects/damage-reports"} className="card px-3 py-3 min-w-[220px] shrink-0 hover:bg-[var(--color-ink-50)] transition-colors flex items-center gap-3">
            {r.photoSignedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.photoSignedUrl} alt="Damage evidence" className="w-12 h-12 rounded-lg object-cover shrink-0 bg-[var(--color-ink-50)]" />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-[var(--color-ink-100)] shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium truncate">{r.itemName ?? "Item"} — {r.damageType}</div>
              <div className="text-[11px] text-[var(--color-ink-400)] truncate">{r.projectName ?? "No project"}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

type StuckCleaningRow = { id: number; description: string; projectName: string | null };
type LowStockRow = { id: number; name: string };

/** Ops nudges the current UI never surfaces anywhere — a line stuck at
 *  "needs cleaning" has no button that ever moves it forward, and low
 *  stock items with a reorderLevel had no consumer for that field at all. */
export function OpsAlertStrip({ stuckCleaning, lowStock }: { stuckCleaning: StuckCleaningRow[]; lowStock: LowStockRow[] }) {
  if (stuckCleaning.length === 0 && lowStock.length === 0) return null;
  return (
    <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 space-y-1.5">
      {stuckCleaning.length > 0 && (
        <div className="text-[12.5px] text-[var(--color-warn)]">
          <span className="font-semibold">🧺 {stuckCleaning.length} item{stuckCleaning.length === 1 ? "" : "s"} stuck needing cleaning</span>
          {" — "}
          <Link href="/manifests" className="hover:underline">{stuckCleaning.slice(0, 3).map((s) => s.description).join(", ")}{stuckCleaning.length > 3 ? "…" : ""}</Link>
        </div>
      )}
      {lowStock.length > 0 && (
        <div className="text-[12.5px] text-[var(--color-warn)]">
          <span className="font-semibold">📉 {lowStock.length} item{lowStock.length === 1 ? "" : "s"} low on stock</span>
          {" — "}
          <Link href="/items" className="hover:underline">{lowStock.slice(0, 4).map((s) => s.name).join(", ")}{lowStock.length > 4 ? "…" : ""}</Link>
        </div>
      )}
    </div>
  );
}

type DeadlineRow = { lineId: number; description: string; status: string; projectId: number; projectName: string; eventDate: string };

/** Forward-looking, not a status snapshot — what needs to move in the next
 *  24-48h across every project, so ops isn't just reacting to what's stuck. */
export function UpcomingManifestDeadlines({ deadlines, today }: { deadlines: DeadlineRow[]; today: string }) {
  if (deadlines.length === 0) return null;
  return (
    <div className="card p-4">
      <div className="text-[12.5px] font-semibold text-[var(--color-ink-600)] mb-2">Needs to move soon</div>
      <div className="space-y-1.5">
        {deadlines.map((d) => {
          const hoursLeft = Math.round((new Date(d.eventDate).getTime() - new Date(today).getTime()) / 3600000);
          const urgent = hoursLeft <= 24;
          return (
            <Link key={d.lineId} href={`/projects/${d.projectId}/manifest`} className="flex items-center justify-between text-[12.5px] group">
              <span className="truncate group-hover:underline">{d.description} — <span className="text-[var(--color-ink-400)]">{d.projectName}</span></span>
              <span className={`shrink-0 ml-3 font-medium tnum ${urgent ? "text-[var(--color-bad)]" : "text-[var(--color-warn)]"}`}>
                {hoursLeft <= 0 ? "due today" : `${hoursLeft}h left`}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function SalesPipelineFunnel({ counts }: { counts: Record<string, number> }) {
  const order = ["lead", "quoted", "confirmed", "in_progress", "completed"] as const;
  return (
    <div>
      <h2 className="text-[15px] font-semibold mb-3">Pipeline</h2>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {order.map((s) => (
          <Link key={s} href="/projects" className="card px-4 py-3 hover:bg-[var(--color-ink-50)] transition-colors">
            <div className="text-[11.5px] text-[var(--color-ink-500)]">{statusLabels[s]}</div>
            <div className="text-[20px] font-semibold mt-0.5">{counts[s] ?? 0}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
