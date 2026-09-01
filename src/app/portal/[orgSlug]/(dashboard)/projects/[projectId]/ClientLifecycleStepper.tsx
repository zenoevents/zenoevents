const STAGES = [
  { key: "lead", label: "Inquiry" },
  { key: "quoted", label: "Quoted" },
  { key: "confirmed", label: "Confirmed" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
] as const;

/** Client-portal lifecycle stepper — deliberately its own small component
 *  rather than reusing the staff LifecycleStepper: that one walks an
 *  8-stage manifest-driven pipeline (draft/packing/loaded/dispatched/...),
 *  internal warehouse-ops vocabulary a client has no reason to see. This
 *  one is purely project.status, already client-safe data. */
export function ClientLifecycleStepper({ status }: { status: string }) {
  if (status === "cancelled") {
    return (
      <div className="card px-5 py-4">
        <span className="inline-block rounded-full bg-red-50 text-[var(--color-bad)] text-[12px] font-medium px-3 py-1">Cancelled</span>
      </div>
    );
  }

  const currentIndex = STAGES.findIndex((s) => s.key === status);

  return (
    <div className="card px-5 py-4 overflow-x-auto">
      <div className="flex items-center w-full min-w-[520px]">
        {STAGES.map((s, i) => {
          const done = i < currentIndex;
          const current = i === currentIndex;
          return (
            <div key={s.key} className={`flex items-center ${i < STAGES.length - 1 ? "flex-1" : ""}`}>
              <div className="flex flex-col items-center gap-1.5 w-[92px] shrink-0">
                <div
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold ${
                    current
                      ? "bg-[var(--color-accent-500)] text-white"
                      : done
                      ? "bg-[var(--color-good)] text-white"
                      : "bg-[var(--color-ink-100)] text-[var(--color-ink-400)]"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </div>
                <div className={`text-[11px] text-center ${current ? "font-semibold text-[var(--color-accent-700)]" : done ? "text-[var(--color-ink-600)]" : "text-[var(--color-ink-400)]"}`}>
                  {s.label}
                </div>
              </div>
              {i < STAGES.length - 1 && (
                <div className={`h-[2px] flex-1 -mt-4 ${done ? "bg-[var(--color-good)]" : "bg-[var(--color-ink-100)]"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { STAGES as CLIENT_LIFECYCLE_STAGES };
