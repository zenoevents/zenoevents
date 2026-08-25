"use client";

import { useState, useTransition } from "react";
import { updateProjectStatusAction } from "@/lib/projects";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/project-status";

const labels: Record<ProjectStatus, string> = {
  lead: "Lead",
  quoted: "Quoted",
  confirmed: "Confirmed",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function ProjectStatusControl({ id, status }: { id: number; status: ProjectStatus }) {
  const [current, setCurrent] = useState(status);
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={current}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as ProjectStatus;
        setCurrent(next);
        startTransition(async () => {
          try {
            await updateProjectStatusAction(id, next);
          } catch (err: any) {
            setCurrent(status);
            alert(err.message ?? "Couldn't update status");
          }
        });
      }}
      className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-1.5 text-[13px] font-medium outline-none focus:border-[var(--color-accent-500)] disabled:opacity-50"
    >
      {PROJECT_STATUSES.map((s) => (
        <option key={s} value={s}>{labels[s]}</option>
      ))}
    </select>
  );
}
