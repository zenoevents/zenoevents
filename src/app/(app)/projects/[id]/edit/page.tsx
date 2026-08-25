import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/guard";
import { getProject, updateProjectAction, listCustomerContacts } from "@/lib/projects";
import { PageHeader, PrimaryButton } from "@/components/ui";

export const dynamic = "force-dynamic";

const input =
  "w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-100)] mt-1";
const label = "text-[12px] font-medium text-[var(--color-ink-600)]";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("projects");
  const { id } = await params;
  const projectId = Number(id);
  const [project, clients] = await Promise.all([getProject(projectId), listCustomerContacts()]);
  if (!project) notFound();

  const updateWithId = updateProjectAction.bind(null, projectId);

  return (
    <>
      <PageHeader title={`Edit — ${project.name}`} />
      <form action={updateWithId} className="card p-6 max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block col-span-2">
          <span className={label}>Event name</span>
          <input name="name" type="text" required defaultValue={project.name} className={input} />
        </label>

        <label className="block">
          <span className={label}>Event date</span>
          <input name="eventDate" type="date" required defaultValue={project.eventDate} className={input} />
        </label>

        <label className="block">
          <span className={label}>Event type</span>
          <input name="eventType" type="text" defaultValue={project.eventType ?? ""} className={input} />
        </label>

        <label className="block">
          <span className={label}>Venue</span>
          <input name="venue" type="text" defaultValue={project.venue ?? ""} className={input} />
        </label>

        <label className="block">
          <span className={label}>Client</span>
          <select name="contactId" defaultValue={project.contactId ?? ""} className={input}>
            <option value="">No client yet — still a lead</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </select>
        </label>

        <label className="block col-span-2">
          <span className={label}>Quoted budget (KES)</span>
          <input name="budget" type="number" step="0.01" min="0" defaultValue={(project.budgetCents / 100).toFixed(2)} className={input} />
        </label>

        <label className="block col-span-2">
          <span className={label}>Notes</span>
          <textarea name="notes" rows={3} defaultValue={project.notes ?? ""} className={input} />
        </label>

        <div className="col-span-2 pt-1">
          <PrimaryButton className="px-5 py-2.5">Save changes</PrimaryButton>
        </div>
      </form>
    </>
  );
}
