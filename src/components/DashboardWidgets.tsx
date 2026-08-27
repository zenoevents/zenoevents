"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addTodo, toggleTodo, deleteTodo, addEvent, deleteEvent } from "@/lib/staff-actions";
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

/* ---------------- Calendar with events ---------------- */

export interface CalEvent {
  /** Composite string id (e.g. "evt-12", "doc-45") — unique across merged event sources. */
  id: string;
  title: string;
  date: string;
  color: string;
  /** Present for system-derived events (invoice/bill due dates, recurring runs) — makes the entry a link instead of plain text. */
  href?: string;
  /** Only manually-added calendar events are deletable. */
  deletable?: boolean;
  /** The underlying `events` table row id, needed for deleteEvent() — only set for manual events. */
  dbId?: number;
  /** Extra detail shown under the title in the selected-day list (venue, status, etc.) */
  subtitle?: string;
}

export function CalendarWidget({ events, maxPerDay = 2 }: { events: CalEvent[]; maxPerDay?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = todayISO();
  const [cursor, setCursor] = useState(() => today.slice(0, 7)); // YYYY-MM
  const [selected, setSelected] = useState<string>(today);
  const [title, setTitle] = useState("");

  const [year, month] = cursor.split("-").map(Number);
  const grid = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const lead = (first.getDay() + 6) % 7; // Monday-start
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${cursor}-${String(d).padStart(2, "0")}`);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor, year, month]);

  const eventDates = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      const list = m.get(e.date) ?? [];
      list.push(e);
      m.set(e.date, list);
    }
    return m;
  }, [events]);

  function moveMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-KE", {
    month: "long",
    year: "numeric",
  });
  const selectedEvents = eventDates.get(selected) ?? [];

  return (
    <div className="card p-5 h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13.5px] font-semibold">Calendar</div>
        <div className="flex items-center gap-1 text-[13px]">
          <button onClick={() => moveMonth(-1)} className="w-7 h-7 rounded-md hover:bg-[var(--color-ink-50)]" aria-label="Previous month">‹</button>
          <span className="min-w-[120px] text-center text-[12.5px] font-medium">{monthLabel}</span>
          <button onClick={() => moveMonth(1)} className="w-7 h-7 rounded-md hover:bg-[var(--color-ink-50)]" aria-label="Next month">›</button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-[10.5px] text-[var(--color-ink-400)] font-semibold uppercase tracking-wide mb-1">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1 gap-x-0.5">
        {grid.map((date, i) => {
          if (!date) return <div key={i} />;
          const evs = eventDates.get(date) ?? [];
          const isToday = date === today;
          const isSelected = date === selected;
          // Subtle amber wash, darker with more same-day entries — a busy
          // or overlapping day (potential double-booking) reads at a
          // glance before opening it, regardless of what kinds of entries
          // populate the calendar (works the same for a plain SME org).
          const densityBg = !isSelected && evs.length >= 2
            ? `color-mix(in srgb, var(--color-warn) ${Math.min(28, 8 + evs.length * 6)}%, transparent)`
            : undefined;
          return (
            <button
              key={i}
              onClick={() => setSelected(date)}
              className={`flex flex-col items-center gap-0.5 rounded-lg py-1 px-0.5 transition-colors ${
                isSelected ? "bg-[var(--color-accent-500)]/10" : densityBg ? "" : "hover:bg-[var(--color-ink-50)]"
              }`}
              style={densityBg ? { background: densityBg } : undefined}
            >
              <span
                className={`w-6 h-6 flex items-center justify-center rounded-full text-[12px] tnum ${
                  isSelected
                    ? "bg-[var(--color-accent-500)] text-white font-semibold"
                    : isToday
                    ? "border border-[var(--color-accent-500)] text-[var(--color-accent-700)] font-semibold"
                    : ""
                }`}
              >
                {Number(date.slice(8))}
              </span>
              <span className="flex flex-col items-stretch gap-[1px] w-full">
                {evs.slice(0, maxPerDay).map((e) => (
                  <span
                    key={e.id}
                    className="text-[7.5px] leading-[10px] font-semibold truncate px-[3px] rounded-[3px]"
                    style={{ background: `${e.color}1a`, color: e.color }}
                  >
                    {e.title}
                  </span>
                ))}
                {evs.length > maxPerDay && (
                  <span className="text-[7.5px] leading-[10px] text-[var(--color-ink-400)] text-center">+{evs.length - maxPerDay}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected day */}
      <div className="hairline-t mt-3 pt-3">
        <div className="text-[11.5px] text-[var(--color-ink-400)] mb-1.5">
          {new Date(selected).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" })}
        </div>
        <ul className="space-y-1 mb-2">
          {selectedEvents.map((e) => (
            <li key={e.id} className="group flex items-center gap-2 text-[12.5px]">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: e.color }} />
              <span className="flex-1 min-w-0">
                {e.href ? (
                  <Link href={e.href} className="block truncate hover:underline" style={{ color: e.color }}>
                    {e.title}
                  </Link>
                ) : (
                  <span className="block truncate">{e.title}</span>
                )}
                {e.subtitle && <span className="block truncate text-[11px] text-[var(--color-ink-400)]">{e.subtitle}</span>}
              </span>
              {e.deletable && e.dbId != null && (
                <button
                  onClick={() =>
                    start(async () => {
                      await deleteEvent(e.dbId!);
                      router.refresh();
                    })
                  }
                  className="opacity-0 group-hover:opacity-100 text-[var(--color-ink-200)] hover:text-[var(--color-bad)]"
                  aria-label="Delete event"
                >
                  ×
                </button>
              )}
            </li>
          ))}
          {selectedEvents.length === 0 && (
            <li className="text-[12px] text-[var(--color-ink-400)]">No events.</li>
          )}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            const t = title;
            setTitle("");
            start(async () => {
              await addEvent(t, selected);
              router.refresh();
            });
          }}
          className="flex gap-2"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`Add event on ${selected.slice(8)}/${selected.slice(5, 7)}…`}
            className="flex-1 min-w-0 rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent-500)]"
          />
          <button
            disabled={pending}
            className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[12.5px] font-medium px-3"
          >
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
