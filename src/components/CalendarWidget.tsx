"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addEvent, deleteEvent } from "@/lib/staff-actions";
import { todayISO } from "@/lib/money";

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
  /** Which of the four event sources this came from — drives the Resources filter. */
  source: "project" | "document" | "recurring" | "manual";
}

const RESOURCES: { key: CalEvent["source"]; label: string; swatch: string }[] = [
  { key: "project", label: "Projects", swatch: "#7c3aed" },
  { key: "document", label: "Invoices & Bills", swatch: "#2563eb" },
  { key: "recurring", label: "Recurring", swatch: "#1f8a4c" },
  { key: "manual", label: "Manual events", swatch: "#515154" },
];

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function startOfWeek(dateStr: string): Date {
  const d = new Date(dateStr);
  const lead = (d.getDay() + 6) % 7; // Monday-start
  d.setDate(d.getDate() - lead);
  return d;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CalendarWidget({ events, maxPerDay = 2 }: { events: CalEvent[]; maxPerDay?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = todayISO();
  const [cursor, setCursor] = useState(() => today.slice(0, 7)); // YYYY-MM
  const [selected, setSelected] = useState<string>(today);
  const [title, setTitle] = useState("");
  const [view, setView] = useState<"month" | "week">("month");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showWeekends, setShowWeekends] = useState(true);
  const [activeSources, setActiveSources] = useState<Set<CalEvent["source"]>>(
    () => new Set(RESOURCES.map((r) => r.key))
  );

  const visibleEvents = useMemo(() => events.filter((e) => activeSources.has(e.source)), [events, activeSources]);

  const [year, month] = cursor.split("-").map(Number);

  const monthGrid = useMemo(() => {
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

  const weekDays = useMemo(() => {
    const start = startOfWeek(selected);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return toISO(d);
    });
  }, [selected]);

  const eventDates = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of visibleEvents) {
      const list = m.get(e.date) ?? [];
      list.push(e);
      m.set(e.date, list);
    }
    return m;
  }, [visibleEvents]);

  function moveMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  function moveWeek(delta: number) {
    const start = startOfWeek(selected);
    start.setDate(start.getDate() + delta * 7);
    const iso = toISO(start);
    setSelected(iso);
    setCursor(iso.slice(0, 7));
  }

  function goToday() {
    setSelected(today);
    setCursor(today.slice(0, 7));
  }

  function toggleSource(key: CalEvent["source"]) {
    setActiveSources((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-KE", { month: "long", year: "numeric" });
  const weekLabel = (() => {
    const startD = new Date(weekDays[0]);
    const endD = new Date(weekDays[6]);
    const sameMonth = startD.getMonth() === endD.getMonth();
    // Built manually rather than via toLocaleDateString with month omitted —
    // some locales (e.g. en-KE) render a day+year-only format as a literal
    // "2026 (day: 30)" string instead of just the day number.
    const monthShort = (d: Date) => d.toLocaleDateString("en-KE", { month: "short" });
    return sameMonth
      ? `${monthShort(startD)} ${startD.getDate()} – ${endD.getDate()}, ${endD.getFullYear()}`
      : `${monthShort(startD)} ${startD.getDate()} – ${monthShort(endD)} ${endD.getDate()}, ${endD.getFullYear()}`;
  })();

  const selectedEvents = eventDates.get(selected) ?? [];
  const visibleWeekdayLabels = showWeekends ? WEEKDAY_LABELS : WEEKDAY_LABELS.slice(0, 5);

  function DayChip({ e }: { e: CalEvent }) {
    return (
      <span
        key={e.id}
        className="block text-[7.5px] leading-[10px] font-semibold truncate px-[3px] rounded-[3px]"
        style={{ background: `${e.color}1a`, color: e.color }}
      >
        {e.title}
      </span>
    );
  }

  return (
    <div className="card p-0 h-full flex overflow-hidden">
      {/* Sidebar */}
      {sidebarOpen && (
        <div className="w-[190px] shrink-0 border-r border-[var(--color-ink-100)] p-3 hidden lg:flex flex-col gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-semibold">{monthLabel}</span>
              <div className="flex items-center gap-0.5">
                <button onClick={() => moveMonth(-1)} className="w-5 h-5 rounded hover:bg-[var(--color-ink-50)] text-[11px]" aria-label="Previous month">‹</button>
                <button onClick={() => moveMonth(1)} className="w-5 h-5 rounded hover:bg-[var(--color-ink-50)] text-[11px]" aria-label="Next month">›</button>
              </div>
            </div>
            <div className="grid grid-cols-7 text-center text-[9px] text-[var(--color-ink-400)] font-semibold uppercase mb-1">
              {WEEKDAY_LABELS.map((d) => <div key={d}>{d[0]}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5">
              {monthGrid.map((date, i) => {
                if (!date) return <div key={i} />;
                const isToday = date === today;
                const isSelected = date === selected;
                return (
                  <button
                    key={i}
                    onClick={() => { setSelected(date); setCursor(date.slice(0, 7)); }}
                    className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] tnum mx-auto ${
                      isSelected ? "bg-[var(--color-accent-500)] text-white font-semibold"
                      : isToday ? "border border-[var(--color-accent-500)] text-[var(--color-accent-700)] font-semibold"
                      : "hover:bg-[var(--color-ink-50)]"
                    }`}
                  >
                    {Number(date.slice(8))}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-[11.5px] font-semibold text-[var(--color-ink-600)] mb-2">Resources</div>
            <div className="space-y-1.5">
              {RESOURCES.map((r) => (
                <label key={r.key} className="flex items-center gap-2 text-[12px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeSources.has(r.key)}
                    onChange={() => toggleSource(r.key)}
                    className="w-3.5 h-3.5 rounded"
                    style={{ accentColor: r.swatch }}
                  />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 min-w-0 p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="w-7 h-7 rounded-md hover:bg-[var(--color-ink-50)] hidden lg:flex items-center justify-center text-[13px]"
              aria-label="Toggle sidebar"
            >
              ☰
            </button>
            <span className="text-[13.5px] font-semibold">{view === "month" ? monthLabel : weekLabel}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => (view === "month" ? moveMonth(-1) : moveWeek(-1))} className="w-7 h-7 rounded-md hover:bg-[var(--color-ink-50)]" aria-label="Previous">‹</button>
            <button onClick={() => (view === "month" ? moveMonth(1) : moveWeek(1))} className="w-7 h-7 rounded-md hover:bg-[var(--color-ink-50)]" aria-label="Next">›</button>
            <button onClick={goToday} className="text-[12px] font-medium text-[var(--color-accent-600)] px-2 py-1 rounded-md hover:bg-[var(--color-accent-50)]">Today</button>
            <select
              value={view}
              onChange={(e) => setView(e.target.value as "month" | "week")}
              className="text-[12px] font-medium rounded-md border border-[var(--color-ink-200)] bg-white px-2 py-1 outline-none"
            >
              <option value="month">Month</option>
              <option value="week">Week</option>
            </select>
            <div className="relative">
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className="w-7 h-7 rounded-md hover:bg-[var(--color-ink-50)] flex items-center justify-center text-[13px]"
                aria-label="Calendar settings"
              >
                ⚙
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-8 z-10 w-44 rounded-lg border border-[var(--color-ink-100)] bg-white shadow-lg py-2">
                  <label className="flex items-center justify-between gap-2 px-3 py-1.5 text-[12.5px] cursor-pointer hover:bg-[var(--color-ink-50)]">
                    <span>Show weekends</span>
                    <input type="checkbox" checked={showWeekends} onChange={(e) => setShowWeekends(e.target.checked)} className="accent-[var(--color-accent-500)]" />
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>

        {view === "month" ? (
          <>
            <div className={`grid ${showWeekends ? "grid-cols-7" : "grid-cols-5"} text-center text-[10.5px] text-[var(--color-ink-400)] font-semibold uppercase tracking-wide mb-1`}>
              {visibleWeekdayLabels.map((d) => <div key={d}>{d}</div>)}
            </div>
            <div className={`grid ${showWeekends ? "grid-cols-7" : "grid-cols-5"} gap-y-1 gap-x-0.5`}>
              {monthGrid
                .filter((date, i) => showWeekends || i % 7 < 5)
                .map((date, i) => {
                  if (!date) return <div key={i} />;
                  const evs = eventDates.get(date) ?? [];
                  const isToday = date === today;
                  const isSelected = date === selected;
                  return (
                    <button
                      key={i}
                      onClick={() => setSelected(date)}
                      className={`flex flex-col items-center gap-0.5 rounded-lg py-1 px-0.5 transition-colors ${
                        isSelected ? "bg-[var(--color-accent-500)]/10" : "hover:bg-[var(--color-ink-50)]"
                      }`}
                    >
                      <span
                        className={`w-6 h-6 flex items-center justify-center rounded-full text-[12px] tnum ${
                          isSelected ? "bg-[var(--color-accent-500)] text-white font-semibold"
                          : isToday ? "border border-[var(--color-accent-500)] text-[var(--color-accent-700)] font-semibold"
                          : ""
                        }`}
                      >
                        {Number(date.slice(8))}
                      </span>
                      <span className="flex flex-col items-stretch gap-[1px] w-full">
                        {evs.slice(0, maxPerDay).map((e) => <DayChip key={e.id} e={e} />)}
                        {evs.length > maxPerDay && (
                          <span className="text-[7.5px] leading-[10px] text-[var(--color-ink-400)] text-center">+{evs.length - maxPerDay}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
            </div>
          </>
        ) : (
          <div className={`grid ${showWeekends ? "grid-cols-7" : "grid-cols-5"} gap-1 flex-1 min-h-[220px]`}>
            {weekDays
              .filter((d) => showWeekends || (new Date(d).getDay() !== 0 && new Date(d).getDay() !== 6))
              .map((date) => {
                const evs = eventDates.get(date) ?? [];
                const isToday = date === today;
                const isSelected = date === selected;
                return (
                  <button
                    key={date}
                    onClick={() => setSelected(date)}
                    className={`flex flex-col items-stretch rounded-lg border p-1.5 text-left transition-colors ${
                      isSelected ? "border-[var(--color-accent-500)] bg-[var(--color-accent-500)]/5" : "border-[var(--color-ink-100)] hover:bg-[var(--color-ink-50)]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9.5px] uppercase font-semibold text-[var(--color-ink-400)]">
                        {new Date(date).toLocaleDateString("en-KE", { weekday: "short" })}
                      </span>
                      <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[11px] tnum ${
                        isSelected ? "bg-[var(--color-accent-500)] text-white font-semibold"
                        : isToday ? "border border-[var(--color-accent-500)] text-[var(--color-accent-700)] font-semibold"
                        : ""
                      }`}>
                        {Number(date.slice(8))}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {evs.map((e) => <DayChip key={e.id} e={e} />)}
                    </div>
                  </button>
                );
              })}
          </div>
        )}

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
    </div>
  );
}
