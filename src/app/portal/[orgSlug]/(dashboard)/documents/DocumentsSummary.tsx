import { fmtKES, todayISO } from "@/lib/money";

interface DocRow {
  status: string;
  totalCents: number;
  paidCents: number;
  dueDate: string | null;
}

function Ring({ pct, color }: { pct: number; color: string }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(100, pct));
  return (
    <svg viewBox="0 0 100 100" width="76" height="76" className="shrink-0">
      <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-ink-100)" strokeWidth="10" />
      <circle
        cx="50" cy="50" r={radius} fill="none"
        stroke={color} strokeWidth="10"
        strokeDasharray={`${(circumference * filled) / 100} ${circumference}`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
        style={{ transition: "stroke-dasharray 1s cubic-bezier(0.22,1,0.36,1)" }}
      />
    </svg>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : tone === "bad" ? "text-[var(--color-bad)]" : "";
  return (
    <div>
      <div className="text-[11px] text-[var(--color-ink-400)]">{label}</div>
      <div className={`text-[17px] font-bold tnum mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

/** The same visual language as the project page's Financial Health card —
 *  a collection/acceptance ring plus stat tiles — instead of a bare table
 *  of rows being the client's whole view of their invoices/quotes. */
export function DocumentsSummary({ type, docs }: { type: "invoice" | "quote"; docs: DocRow[] }) {
  const real = docs.filter((d) => d.status !== "draft" && d.status !== "void");
  if (real.length === 0) return null;

  if (type === "invoice") {
    const totalCents = real.reduce((s, d) => s + d.totalCents, 0);
    const collectedCents = real.reduce((s, d) => s + d.paidCents, 0);
    const outstandingCents = Math.max(0, totalCents - collectedCents);
    const today = todayISO();
    const overdueCount = real.filter((d) => ["open", "partial"].includes(d.status) && d.dueDate && d.dueDate < today).length;
    const pct = totalCents > 0 ? (collectedCents / totalCents) * 100 : 0;

    return (
      <div className="card p-5 mb-5">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="flex items-center gap-4 shrink-0">
            <Ring pct={pct} color="var(--color-good)" />
            <div>
              <div className="text-[20px] font-bold tnum">{Math.round(pct)}%</div>
              <div className="text-[11px] text-[var(--color-ink-400)]">collected</div>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4 w-full">
            <Stat label="Total invoiced" value={fmtKES(totalCents)} />
            <Stat label="Collected" value={fmtKES(collectedCents)} tone="good" />
            <Stat label="Outstanding" value={fmtKES(outstandingCents)} tone={outstandingCents > 0 ? "warn" : undefined} />
            <Stat label="Overdue" value={String(overdueCount)} tone={overdueCount > 0 ? "bad" : undefined} />
          </div>
        </div>
      </div>
    );
  }

  const totalCents = real.reduce((s, d) => s + d.totalCents, 0);
  const acceptedDocs = real.filter((d) => d.status === "accepted" || d.status === "converted");
  const acceptedCents = acceptedDocs.reduce((s, d) => s + d.totalCents, 0);
  const pendingCount = real.filter((d) => d.status === "sent").length;
  const acceptPct = real.length > 0 ? (acceptedDocs.length / real.length) * 100 : 0;

  return (
    <div className="card p-5 mb-5">
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="flex items-center gap-4 shrink-0">
          <Ring pct={acceptPct} color="var(--color-brand, #0f766e)" />
          <div>
            <div className="text-[20px] font-bold tnum">{Math.round(acceptPct)}%</div>
            <div className="text-[11px] text-[var(--color-ink-400)]">accepted</div>
          </div>
        </div>
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-4 w-full">
          <Stat label="Total quoted" value={fmtKES(totalCents)} />
          <Stat label="Accepted" value={fmtKES(acceptedCents)} tone="good" />
          <Stat label="Awaiting response" value={String(pendingCount)} tone={pendingCount > 0 ? "warn" : undefined} />
        </div>
      </div>
    </div>
  );
}
