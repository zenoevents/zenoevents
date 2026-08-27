import Link from "next/link";
import { LINE_STATUSES } from "@/lib/manifest-status";

type Line = { itemName: string | null; status: string };

function worstStatus(lines: Line[]): string {
  let worstIndex: number = LINE_STATUSES.length;
  let worst = lines[0]?.status ?? "pending";
  for (const l of lines) {
    const idx = LINE_STATUSES.indexOf(l.status as (typeof LINE_STATUSES)[number]);
    if (idx < worstIndex) {
      worstIndex = idx;
      worst = l.status;
    }
  }
  return worst;
}

function dotColor(status: string): string {
  if (status.startsWith("inspected_")) return status === "inspected_good" ? "bg-[var(--color-good)]" : "bg-[var(--color-bad)]";
  if (status === "returned" || status === "collected" || status === "dispatched") return "bg-[var(--color-good)]";
  if (status === "loaded" || status === "picked") return "bg-[var(--color-warn)]";
  return "bg-[var(--color-ink-200)]";
}

export function ManifestReadiness({ projectId, manifestExists, pickedCount, totalDurable, lines }: {
  projectId: number;
  manifestExists: boolean;
  pickedCount: number;
  totalDurable: number;
  lines: Line[];
}) {
  if (!manifestExists) {
    return (
      <div className="card p-5 flex items-center justify-center text-center">
        <div className="text-[12.5px] text-[var(--color-ink-300)]">
          No manifest yet —{" "}
          <Link href={`/projects/${projectId}/manifest`} className="text-[var(--color-accent-600)] hover:underline">
            create one
          </Link>
        </div>
      </div>
    );
  }

  const pct = totalDurable > 0 ? Math.round((pickedCount / totalDurable) * 100) : 0;

  const groups = new Map<string, Line[]>();
  for (const l of lines) {
    const key = l.itemName ?? "Item";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12.5px] font-semibold text-[var(--color-ink-600)]">Manifest readiness</div>
        <Link href={`/projects/${projectId}/manifest`} className="text-[11px] text-[var(--color-accent-600)] hover:underline">View manifest</Link>
      </div>
      <div className="text-[11.5px] text-[var(--color-ink-400)] mb-1.5">{pickedCount} of {totalDurable} items picked</div>
      <div className="h-2 rounded-full bg-[var(--color-ink-100)] overflow-hidden mb-3">
        <div className="h-full bg-[var(--color-accent-500)]" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {[...groups.entries()].map(([name, group]) => (
          <span key={name} className="flex items-center gap-1.5 text-[11px] text-[var(--color-ink-600)]">
            <span className={`inline-block w-2 h-2 rounded-full ${dotColor(worstStatus(group))}`} />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
