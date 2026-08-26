import { requirePerm } from "@/lib/guard";
import { listDamageReportsQueue } from "@/lib/damage-reports";
import { PageHeader, EmptyState } from "@/components/ui";
import { DamageQueueClient } from "./DamageQueueClient";

export const dynamic = "force-dynamic";

export default async function DamageReportsQueuePage() {
  await requirePerm("projects");
  const reports = await listDamageReportsQueue();

  return (
    <>
      <PageHeader
        title="Damage Reports"
        subtitle="Every photo-verified damage report, oldest liability calls first — resolve who's responsible and whether it gets billed."
      />
      {reports.length === 0 ? (
        <EmptyState
          title="No damage reports yet"
          body="Reports filed from a project's Damage reports section will show up here for liability resolution."
        />
      ) : (
        <DamageQueueClient reports={reports} />
      )}
    </>
  );
}
