"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProjectWithClientAction } from "@/lib/projects";

const inputCls =
  "w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-100)] mt-1";
const labelCls = "text-[12px] font-medium text-[var(--color-ink-600)]";

interface ClientOption { id: number; displayName: string }
interface GroupOption { id: number; name: string }

export function NewProjectForm({
  clients,
  groups,
  groupsRequired,
}: {
  clients: ClientOption[];
  groups: GroupOption[];
  groupsRequired: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"existing" | "new">(clients.length === 0 ? "new" : "existing");

  function submit(formData: FormData) {
    setError(null);
    formData.set("mode", mode);
    start(async () => {
      const res = await createProjectWithClientAction(formData);
      if ("error" in res) setError(res.error);
      else router.push(`/projects/${res.id}`);
    });
  }

  return (
    <form action={submit} className="card p-6 max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label className="block col-span-2">
        <span className={labelCls}>Event name</span>
        <input name="name" type="text" required placeholder="e.g. Otieno Wedding" className={inputCls} />
      </label>

      <label className="block">
        <span className={labelCls}>Event date</span>
        <input name="eventDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputCls} />
      </label>

      <label className="block">
        <span className={labelCls}>Event type</span>
        <input name="eventType" type="text" placeholder="Wedding, corporate, gala…" className={inputCls} />
      </label>

      <label className="block">
        <span className={labelCls}>Venue</span>
        <input name="venue" type="text" placeholder="e.g. Karen Country Club" className={inputCls} />
      </label>

      <label className="block">
        <span className={labelCls}>Color theme</span>
        <input name="colorTheme" type="text" placeholder="e.g. Sage green & gold" className={inputCls} />
      </label>

      <div className="col-span-2 rounded-lg border border-[var(--color-ink-100)] p-3.5 space-y-3">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-ink-600)]">
          <span>Client</span>
          <span className="text-[var(--color-ink-300)] font-normal">— pick who this is for now, so their first quote or invoice doesn't dead-end on an empty customer picker.</span>
        </div>

        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setMode("existing")}
            className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${mode === "existing" ? "bg-[var(--color-accent-500)] text-white" : "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]"}`}
          >
            Existing client
          </button>
          <button
            type="button"
            onClick={() => setMode("new")}
            className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${mode === "new" ? "bg-[var(--color-accent-500)] text-white" : "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]"}`}
          >
            New client
          </button>
        </div>

        {mode === "existing" ? (
          <select name="contactId" defaultValue="" className={inputCls + " mt-0"}>
            <option value="">No client yet — still a lead</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </select>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2">
              <span className={labelCls}>Client name</span>
              <input name="clientName" type="text" required placeholder="e.g. Jane Wanjiru" className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>Phone</span>
              <input name="clientPhone" type="text" placeholder="0722 000 000" className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>Email</span>
              <input name="clientEmail" type="email" placeholder="jane@example.com" className={inputCls} />
            </label>
            {groupsRequired && (
              <label className="block sm:col-span-2">
                <span className={labelCls}>Customer group</span>
                <select name="clientGroupId" required defaultValue="" className={inputCls}>
                  <option value="" disabled>Select a group…</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
      </div>

      <label className="block col-span-2">
        <span className={labelCls}>Quoted budget (KES)</span>
        <input name="budget" type="number" step="0.01" min="0" placeholder="0.00" className={inputCls} />
        <p className="text-[11px] text-[var(--color-ink-400)] mt-1">
          What the event is quoted at — actual cost and invoiced amounts are tracked against this once vendor bills and milestone invoices are tagged to the project.
        </p>
      </label>

      <label className="block col-span-2">
        <span className={labelCls}>Notes</span>
        <textarea name="notes" rows={3} placeholder="Anything worth flagging about this event" className={inputCls} />
      </label>

      {error && <div className="col-span-2 text-[12.5px] text-[var(--color-bad)]">{error}</div>}

      <div className="col-span-2 pt-1">
        <button
          disabled={pending}
          className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-50 text-white text-[13px] font-medium px-5 py-2.5 transition-colors"
        >
          {pending ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}
