"use client";

import { useState } from "react";
import Link from "next/link";
import { resolveDamageReportAction, getDamagePhotoUrlAction } from "@/lib/damage-reports";
import { LIABILITY_STATUSES } from "@/lib/liability-status";
import { fmtKES } from "@/lib/money";

type Report = {
  id: number;
  itemLabel: string | null;
  itemName: string | null;
  projectId: number | null;
  projectName: string | null;
  reportedByName: string | null;
  damageType: string;
  description: string | null;
  photoUrl: string;
  stageReported: string;
  liabilityStatus: string;
  billedToClient: boolean;
  billedAmountCents: number;
  documentId: number | null;
  createdAt: string;
};

const stageLabels: Record<string, string> = {
  loading: "Loading",
  collection: "Collection",
  inspection: "Inspection",
};

const liabilityLabels: Record<string, string> = {
  pending: "Awaiting review",
  staff_fault: "Staff/warehouse fault",
  client_fault: "Client fault",
  wear_and_tear: "Normal wear and tear",
  unresolved: "Unresolved",
};

function ReportCard({ report }: { report: Report }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [liabilityStatus, setLiabilityStatus] = useState(report.liabilityStatus === "pending" ? "staff_fault" : report.liabilityStatus);
  const [billToClient, setBillToClient] = useState(report.billedToClient);
  const [amount, setAmount] = useState(report.billedAmountCents ? (report.billedAmountCents / 100).toFixed(2) : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPhoto() {
    const result = await getDamagePhotoUrlAction(report.photoUrl);
    if (typeof result === "string") setPhotoUrl(result);
  }

  async function resolve() {
    setError(null);
    setPending(true);
    try {
      const result = await resolveDamageReportAction({
        id: report.id,
        liabilityStatus: liabilityStatus as any,
        billToClient,
        billedAmountCents: billToClient ? Math.round(parseFloat(amount || "0") * 100) : undefined,
      });
      if ("error" in result) { setError(result.error); return; }
      window.location.reload();
    } finally {
      setPending(false);
    }
  }

  const isResolved = report.liabilityStatus !== "pending";

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-[14px]">{report.itemName} — {report.itemLabel}</div>
          <div className="text-[12px] text-[var(--color-ink-400)] mt-0.5">
            {report.damageType} · {stageLabels[report.stageReported] ?? report.stageReported} ·{" "}
            {report.projectId ? <Link href={`/projects/${report.projectId}`} className="hover:underline">{report.projectName}</Link> : "No project"}
            {report.reportedByName ? ` · reported by ${report.reportedByName}` : ""}
          </div>
          {report.description && <p className="text-[12.5px] text-[var(--color-ink-600)] mt-1">{report.description}</p>}
        </div>
        <span className="text-[11px] font-medium shrink-0 rounded-full px-2.5 py-1 bg-[var(--color-ink-100)] text-[var(--color-ink-600)]">
          {liabilityLabels[report.liabilityStatus] ?? report.liabilityStatus}
        </span>
      </div>

      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="Damage photo" className="h-40 w-40 rounded-lg object-cover border border-[var(--color-ink-200)]" />
      ) : (
        <button onClick={loadPhoto} className="text-[12.5px] text-[var(--color-accent-600)] hover:underline">View photo</button>
      )}

      {isResolved ? (
        report.billedToClient && (
          <div className="text-[12.5px] text-[var(--color-ink-600)]">
            Billed to client: <Money cents={report.billedAmountCents} />
            {report.documentId && <Link href={`/sales/invoices/${report.documentId}`} className="ml-2 text-[var(--color-accent-600)] hover:underline">View invoice</Link>}
          </div>
        )
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 space-y-2.5">
          <select value={liabilityStatus} onChange={(e) => setLiabilityStatus(e.target.value)} className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]">
            {LIABILITY_STATUSES.filter((s) => s !== "pending").map((s) => <option key={s} value={s}>{liabilityLabels[s]}</option>)}
          </select>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={billToClient} onChange={(e) => setBillToClient(e.target.checked)} />
            Bill this to the client
          </label>
          {billToClient && (
            <input
              type="number" step="0.01" min="0.01" placeholder="Amount (KES)"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]"
            />
          )}
          {error && <div className="text-[12px] text-[var(--color-bad)]">{error}</div>}
          <button
            disabled={pending}
            onClick={resolve}
            className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[13px] font-medium px-4 py-2 transition-colors disabled:opacity-50"
          >
            {pending ? "Resolving…" : "Resolve"}
          </button>
        </div>
      )}
    </div>
  );
}

function Money({ cents, className = "" }: { cents: number; className?: string }) {
  return <span className={`tnum font-medium ${className}`}>{fmtKES(cents)}</span>;
}

export function DamageQueueClient({ reports }: { reports: Report[] }) {
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const visible = filter === "pending" ? reports.filter((r) => r.liabilityStatus === "pending") : reports;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setFilter("pending")} className={`text-[12.5px] font-medium px-3 py-1.5 rounded-full ${filter === "pending" ? "bg-[var(--color-accent-500)] text-white" : "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]"}`}>
          Pending ({reports.filter((r) => r.liabilityStatus === "pending").length})
        </button>
        <button onClick={() => setFilter("all")} className={`text-[12.5px] font-medium px-3 py-1.5 rounded-full ${filter === "all" ? "bg-[var(--color-accent-500)] text-white" : "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]"}`}>
          All ({reports.length})
        </button>
      </div>
      {visible.length === 0 ? (
        <div className="text-[13px] text-[var(--color-ink-400)]">Nothing here.</div>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => <ReportCard key={r.id} report={r} />)}
        </div>
      )}
    </div>
  );
}
