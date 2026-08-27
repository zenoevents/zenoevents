import { LIFECYCLE_STAGES, type LifecycleStage } from "@/lib/lifecycle-stage";

export function LifecycleStepper({ stage, cancelled }: { stage: LifecycleStage; cancelled: boolean }) {
  if (cancelled) {
    return (
      <div className="card px-5 py-4 mb-6">
        <span className="inline-block rounded-full bg-red-50 text-[var(--color-bad)] text-[12px] font-medium px-3 py-1">Cancelled</span>
      </div>
    );
  }

  const currentIndex = LIFECYCLE_STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="card px-5 py-4 mb-6 overflow-x-auto">
      <div className="flex items-center min-w-max">
        {LIFECYCLE_STAGES.map((s, i) => {
          const done = i < currentIndex;
          const current = i === currentIndex;
          return (
            <div key={s.key} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5 w-[92px]">
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
              {i < LIFECYCLE_STAGES.length - 1 && (
                <div className={`h-[2px] w-6 -mt-4 ${done ? "bg-[var(--color-good)]" : "bg-[var(--color-ink-100)]"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
