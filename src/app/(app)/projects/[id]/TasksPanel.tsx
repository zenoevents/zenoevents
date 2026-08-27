"use client";

import { useState } from "react";
import { createTaskAction, toggleTaskAction, deleteTaskAction } from "@/lib/project-tasks";
import { EmptyState } from "@/components/ui";

type TaskRow = {
  id: number;
  title: string;
  description: string | null;
  assignedMemberId: number | null;
  assignedMemberName: string | null;
  dueDate: string | null;
  done: boolean;
  completedAt: string | null;
};

type StaffOption = { id: number; label: string };

export function TasksPanel({ projectId, tasks, staff }: { projectId: number; tasks: TaskRow[]; staff: StaffOption[] }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedMemberId, setAssignedMemberId] = useState<number | "">("");
  const [dueDate, setDueDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    window.location.reload();
  }

  async function submit() {
    setError(null);
    if (!title.trim()) { setError("Task title is required"); return; }
    setPending(true);
    try {
      const result = await createTaskAction({
        projectId, title, description,
        assignedMemberId: assignedMemberId === "" ? null : Number(assignedMemberId),
        dueDate: dueDate || null,
      });
      if ("error" in result) { setError(result.error); return; }
      refresh();
    } finally {
      setPending(false);
    }
  }

  async function toggle(id: number, done: boolean) {
    await toggleTaskAction(id, done);
    refresh();
  }

  async function remove(id: number) {
    if (!confirm("Delete this task?")) return;
    await deleteTaskAction(id);
    refresh();
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {tasks.length === 0 ? (
        <EmptyState title="No tasks yet" body="Site visits, follow-ups, anything staff need to do for this event — assign it here." />
      ) : (
        <div className="space-y-1.5">
          {tasks.map((t) => (
            <div key={t.id} className="group flex items-start gap-2.5 rounded-lg border border-[var(--color-ink-100)] px-3 py-2.5">
              <input
                type="checkbox"
                checked={t.done}
                onChange={(e) => toggle(t.id, e.target.checked)}
                className="accent-[var(--color-accent-500)] mt-0.5 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className={`text-[13.5px] ${t.done ? "line-through text-[var(--color-ink-400)]" : "font-medium"}`}>{t.title}</div>
                <div className="text-[11.5px] text-[var(--color-ink-400)] mt-0.5">
                  {t.assignedMemberName ? `Assigned to ${t.assignedMemberName}` : "Unassigned"}
                  {t.dueDate && ` · Due ${t.dueDate}`}
                  {t.done && t.completedAt && ` · Done ${t.completedAt}`}
                </div>
                {t.description && <div className="text-[12.5px] text-[var(--color-ink-600)] mt-1">{t.description}</div>}
              </div>
              <button
                onClick={() => remove(t.id)}
                className="opacity-0 group-hover:opacity-100 text-[var(--color-ink-200)] hover:text-[var(--color-bad)] shrink-0"
                aria-label="Delete task"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-dashed border-[var(--color-ink-200)] p-4 space-y-2.5">
        <div className="text-[12px] font-medium text-[var(--color-ink-600)]">New task</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Site visit — venue survey"
          className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
        <div className="grid grid-cols-2 gap-2">
          <select value={assignedMemberId} onChange={(e) => setAssignedMemberId(e.target.value ? Number(e.target.value) : "")}
            className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]">
            <option value="">Unassigned</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <input type="date" value={dueDate} min={today} onChange={(e) => setDueDate(e.target.value)}
            className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Details (optional)"
          className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
        {error && <div className="text-[12px] text-[var(--color-bad)]">{error}</div>}
        <button disabled={pending} onClick={submit} className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[13px] font-medium px-4 py-2 transition-colors disabled:opacity-50">
          {pending ? "Saving…" : "Add task"}
        </button>
      </div>
    </div>
  );
}
