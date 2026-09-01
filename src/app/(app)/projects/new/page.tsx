import { requirePerm } from "@/lib/guard";
import { getOrg } from "@/lib/org";
import { listCustomerContacts } from "@/lib/projects";
import { listCustomerGroups } from "@/lib/customer-groups";
import { PageHeader } from "@/components/ui";
import { NewProjectForm } from "./NewProjectForm";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  await requirePerm("projects");
  const [o, clients, groups] = await Promise.all([getOrg(), listCustomerContacts(), listCustomerGroups()]);

  return (
    <>
      <PageHeader title="New project" subtitle="One event, start to finish — client, date, budget, and everything else hangs off this." />
      <NewProjectForm
        clients={clients}
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        groupsRequired={o.customerGroupsEnabled}
      />
    </>
  );
}
