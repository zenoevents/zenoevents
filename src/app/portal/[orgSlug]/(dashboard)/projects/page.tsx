import { getClientSession } from "@/lib/client-portal/auth";
import { listClientProjects } from "@/lib/client-portal/projects";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ClientPortalProjects({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const session = await getClientSession(orgSlug);
  if (!session) redirect(`/portal/${orgSlug}/login`);

  const rows = await listClientProjects(session.orgId, session.contactId);

  return (
    <>
      <PageHeader title="Your Projects" subtitle="Every event we're working on together." />

      {rows.length === 0 ? (
        <div className="card px-5 py-12 text-center text-[13.5px] text-[var(--color-ink-500)] border border-[var(--color-ink-100)] max-w-4xl">
          Nothing here yet — once we start planning your event, it'll show up here.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-4xl">
          {rows.map((p) => (
            <Link key={p.id} href={`/portal/${orgSlug}/projects/${p.id}`} className="card px-5 py-4 hover:shadow-md transition-shadow border border-[var(--color-ink-100)]">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-[14.5px]">{p.name}</div>
                <StatusPill status={p.status} />
              </div>
              <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1">
                {p.eventType || "Event"}{p.venue ? ` · ${p.venue}` : ""}
              </div>
              <div className="text-[12.5px] text-[var(--color-ink-400)] mt-0.5">{p.eventDate}</div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
