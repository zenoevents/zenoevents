"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTodo, toggleTodo, deleteTodo } from "@/lib/staff-actions";
import { fmtKESCompact, todayISO } from "@/lib/money";

/* ---------------- Income vs expense bar chart ---------------- */

export function IncomeExpenseChart({
  data,
  eventCounts,
}: {
  data: { label: string; incomeCents: number; expenseCents: number }[];
  /** Optional, parallel-indexed to `data` — non-cancelled projects whose
   *  event date falls in that month. Lets admin see "August was huge
   *  because we had 4 weddings," not just a raw KSh total. */
  eventCounts?: number[];
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.incomeCents, d.expenseCents]));
  return (
    <div className="card p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[13.5px] font-semibold">Income vs spending</div>
        <div className="flex items-center gap-4 text-[11px] text-[var(--color-ink-400)]">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[var(--color-accent-500)]" /> Income
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[var(--color-ink-200)]" /> Spending
          </span>
          {eventCounts && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--color-warn)]" /> Events
            </span>
          )}
        </div>
      </div>
      <div className="flex items-end gap-2 sm:gap-4 flex-1 min-h-[10rem]">
        {data.map((d, i) => (
          <div key={d.label} className="flex-1 flex flex-col items-center min-w-0 h-full">
            {eventCounts && (
              <div className="text-[10px] font-semibold text-[var(--color-warn)] mb-1 tnum">
                {eventCounts[i] > 0 ? `● ${eventCounts[i]}` : ""}
              </div>
            )}
            <div className="w-full flex items-end justify-center gap-1 flex-1">
              <div
                className="w-3 sm:w-5 rounded-t bg-[var(--color-accent-500)] transition-all"
                style={{ height: `${Math.max(2, (d.incomeCents / max) * 100)}%` }}
                title={`Income ${fmtKESCompact(d.incomeCents)}`}
              />
              <div
                className="w-3 sm:w-5 rounded-t bg-[var(--color-ink-200)] transition-all"
                style={{ height: `${Math.max(2, (d.expenseCents / max) * 100)}%` }}
                title={`Spending ${fmtKESCompact(d.expenseCents)}`}
              />
            </div>
            <div className="text-[10.5px] text-[var(--color-ink-400)] mt-1">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Todo list ---------------- */

export interface TodoItem {
  id: number;
  title: string;
  done: boolean;
  dueDate: string | null;
}

export function TodoWidget({ todos }: { todos: TodoItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const today = todayISO();

  return (
    <div className="card p-5">
      <div className="text-[13.5px] font-semibold mb-3">To-do</div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          const t = title;
          setTitle("");
          start(async () => {
            await addTodo(t);
            router.refresh();
          });
        }}
        className="flex gap-2 mb-3"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task… e.g. File VAT by 20th"
          className="flex-1 rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]"
        />
        <button
          disabled={pending}
          className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[13px] font-medium px-3"
        >
          Add
        </button>
      </form>
      <ul className="space-y-1 max-h-56 overflow-y-auto">
        {todos.map((t) => (
          <li key={t.id} className="group flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-[var(--color-ink-50)]">
            <input
              type="checkbox"
              checked={t.done}
              onChange={(e) =>
                start(async () => {
                  await toggleTodo(t.id, e.target.checked);
                  router.refresh();
                })
              }
              className="accent-[var(--color-accent-500)] shrink-0"
            />
            <span className={`flex-1 text-[13px] min-w-0 truncate ${t.done ? "line-through text-[var(--color-ink-400)]" : ""}`}>
              {t.title}
            </span>
            {t.dueDate && (
              <span className={`text-[11px] tnum shrink-0 ${!t.done && t.dueDate < today ? "text-[var(--color-bad)]" : "text-[var(--color-ink-400)]"}`}>
                {t.dueDate}
              </span>
            )}
            <button
              onClick={() =>
                start(async () => {
                  await deleteTodo(t.id);
                  router.refresh();
                })
              }
              className="opacity-0 group-hover:opacity-100 text-[var(--color-ink-200)] hover:text-[var(--color-bad)] shrink-0"
              aria-label="Delete task"
            >
              ×
            </button>
          </li>
        ))}
        {todos.length === 0 && (
          <li className="text-[12.5px] text-[var(--color-ink-400)] px-1.5 py-3">
            Nothing yet — capture the small stuff before it becomes big stuff.
          </li>
        )}
      </ul>
    </div>
  );
}

