import Link from "next/link";
import { requirePerm } from "@/lib/guard";
import { listMyManifestTasks } from "@/lib/manifests";
import { LINE_STATUS_LABELS } from "@/lib/manifest-status";
import { PageHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function MyManifestTasksPage() {
  await requirePerm("manifests");
  const tasks = await listMyManifestTasks();

  return (
    <>
      <PageHeader
        title="My Tasks"
        subtitle="Every manifest line waiting on your role, across every project — oldest event date first."
      />
      {tasks.length === 0 ? (
        <EmptyState title="Nothing waiting on you" body="Lines that need picking, loading, dispatching, collecting, or inspecting by your role will show up here." />
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <Link key={t.lineId} href={`/projects/${t.projectId}/manifest`} className="block rounded-lg border border-[var(--color-ink-100)] px-4 py-3 hover:bg-[var(--color-ink-50)] transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-[13.5px]">{t.description}</div>
                  <div className="text-[11.5px] text-[var(--color-ink-400)] mt-0.5">{t.projectName} · {t.eventDate} · qty {t.qtyRequested}</div>
                </div>
                <span className="text-[11px] font-medium shrink-0 rounded-full px-2.5 py-1 bg-[var(--color-ink-100)] text-[var(--color-ink-600)]">
                  {LINE_STATUS_LABELS[t.status] ?? t.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
