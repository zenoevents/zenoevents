import { requirePerm } from "@/lib/guard";
import { createProjectAction, listCustomerContacts } from "@/lib/projects";
import { PageHeader, PrimaryButton } from "@/components/ui";

export const dynamic = "force-dynamic";

const input =
  "w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-100)] mt-1";
const label = "text-[12px] font-medium text-[var(--color-ink-600)]";

export default async function NewProjectPage() {
  await requirePerm("projects");
  const clients = await listCustomerContacts();

  return (
    <>
      <PageHeader title="New project" subtitle="One event, start to finish — client, date, budget, and everything else hangs off this." />
      <form action={createProjectAction} className="card p-6 max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block col-span-2">
          <span className={label}>Event name</span>
          <input name="name" type="text" required placeholder="e.g. Otieno Wedding" className={input} />
        </label>

        <label className="block">
          <span className={label}>Event date</span>
          <input name="eventDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={input} />
        </label>

        <label className="block">
          <span className={label}>Event type</span>
          <input name="eventType" type="text" placeholder="Wedding, corporate, gala…" className={input} />
        </label>

        <label className="block">
          <span className={label}>Venue</span>
          <input name="venue" type="text" placeholder="e.g. Karen Country Club" className={input} />
        </label>

        <label className="block">
          <span className={label}>Client</span>
          <select name="contactId" defaultValue="" className={input}>
            <option value="">No client yet — still a lead</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </select>
        </label>

        <label className="block col-span-2">
          <span className={label}>Quoted budget (KES)</span>
          <input name="budget" type="number" step="0.01" min="0" placeholder="0.00" className={input} />
          <p className="text-[11px] text-[var(--color-ink-400)] mt-1">
            What the event is quoted at — actual cost and invoiced amounts are tracked against this once vendor bills and milestone invoices are tagged to the project.
          </p>
        </label>

        <label className="block col-span-2">
          <span className={label}>Notes</span>
          <textarea name="notes" rows={3} placeholder="Anything worth flagging about this event" className={input} />
        </label>

        <div className="col-span-2 pt-1">
          <PrimaryButton className="px-5 py-2.5">Create project</PrimaryButton>
        </div>
      </form>
    </>
  );
}
