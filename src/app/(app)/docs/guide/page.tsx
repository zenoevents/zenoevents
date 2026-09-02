import { GUIDE_META, GUIDE_SECTIONS, ROLE_MATRIX, ROLE_LABELS } from "@/content/guide";
import { PageHeader } from "@/components/ui";

function TagPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-[var(--color-ink-50)] border border-[var(--color-ink-100)] px-2.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--color-ink-500)]">
      {children}
    </span>
  );
}

export default function GuidePage() {
  return (
    <>
      <PageHeader title="Documentation" subtitle="The complete guide to running your events business on Zeno." />

      {/* Cover */}
      <div className="rounded-2xl px-8 py-10 mb-6 shadow-[var(--shadow-card)] border border-[var(--color-ink-100)] bg-[var(--color-ink-900)] text-white">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50 mb-3">{GUIDE_META.title}</div>
        <h1 className="text-[28px] font-bold tracking-tight max-w-2xl">{GUIDE_META.subtitle}</h1>
        <p className="text-[13px] text-white/60 mt-4 max-w-2xl">
          This page always reflects the current system — if this guide and the app ever disagree, trust the app. A downloadable PDF version exists too, but this page is the one that's always up to date.
        </p>
        <a
          href="/zeno-system-guide.pdf"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 mt-6 px-4 py-2.5 bg-white text-[var(--color-ink-900)] text-[13px] font-semibold rounded-full hover:bg-white/90 transition-colors w-fit"
        >
          ⬇ Download the PDF
        </a>
      </div>

      {/* In-page nav */}
      <div className="card px-6 py-5 mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-400)] mb-3">On this page</div>
        <div className="flex flex-wrap gap-2">
          {GUIDE_SECTIONS.map((s) => (
            <a
              key={s.number}
              href={`#section-${s.number}`}
              className="text-[12.5px] text-[var(--color-ink-600)] hover:text-[var(--color-accent-600)] hover:underline px-2.5 py-1 rounded-full hover:bg-[var(--color-ink-50)] transition-colors"
            >
              {s.number} · {s.title}
            </a>
          ))}
        </div>
      </div>

      {/* Role matrix */}
      <div id="role-matrix" className="card px-6 py-6 mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-400)] mb-1">Quick reference</div>
        <h2 className="text-[18px] font-bold tracking-tight mb-4">Who sees what, by default</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="hairline-b text-left text-[var(--color-ink-400)]">
                <th className="py-2 pr-4 font-medium">Module</th>
                {Object.values(ROLE_LABELS).map((label) => (
                  <th key={label} className="py-2 px-2 font-medium text-center whitespace-nowrap">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLE_MATRIX.map((row) => (
                <tr key={row.module} className="hairline-t">
                  <td className="py-2 pr-4 font-medium text-[var(--color-ink-800)] whitespace-nowrap">{row.module}</td>
                  {Object.keys(ROLE_LABELS).map((roleKey) => (
                    <td key={roleKey} className="py-2 px-2 text-center">
                      {row.roles.includes(roleKey) ? (
                        <span className="text-[var(--color-good)]">●</span>
                      ) : (
                        <span className="text-[var(--color-ink-100)]">·</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11.5px] text-[var(--color-ink-400)] mt-3">
          Defaults, adjustable per organization by an admin under Staff & Roles. See Section 19.
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-6">
        {GUIDE_SECTIONS.map((s) => (
          <div key={s.number} id={`section-${s.number}`} className="card px-6 py-6 scroll-mt-6">
            <div className="flex items-start gap-4">
              <div className="shrink-0 w-11 h-11 rounded-2xl bg-[var(--color-ink-900)] text-white flex items-center justify-center font-bold text-[15px]">
                {s.number}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-[19px] font-bold tracking-tight text-[var(--color-ink-900)]">{s.title}</h2>
                {s.subtitle && <p className="text-[13px] text-[var(--color-ink-400)] mt-0.5">{s.subtitle}</p>}
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {s.tags.map((t) => <TagPill key={t}>{t}</TagPill>)}
                </div>
              </div>
            </div>

            <p className="text-[13.5px] text-[var(--color-ink-700)] leading-relaxed mt-4">{s.summary}</p>

            <div className="text-[11.5px] text-[var(--color-ink-400)] mt-2">
              <span className="font-semibold text-[var(--color-ink-500)]">Roles: </span>
              {s.roles.join(" · ")}
            </div>

            {s.screenshotCaption && (
              <div className="mt-4 rounded-xl border border-dashed border-[var(--color-ink-200)] bg-[var(--color-ink-50)]/60 px-5 py-6 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-white border border-[var(--color-ink-200)] flex items-center justify-center text-[16px] shrink-0">🖥️</div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-400)]">Preview this screen live</div>
                  <div className="text-[13px] text-[var(--color-ink-600)] mt-0.5">{s.screenshotCaption}</div>
                </div>
              </div>
            )}

            {s.keyConcepts && s.keyConcepts.length > 0 && (
              <div className="mt-5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-400)] mb-2">Key concepts</div>
                <ul className="space-y-1.5">
                  {s.keyConcepts.map((c, i) => (
                    <li key={i} className="text-[13px] text-[var(--color-ink-700)] leading-relaxed pl-4 relative before:content-['—'] before:absolute before:left-0 before:text-[var(--color-ink-300)]">
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {s.steps && s.steps.length > 0 && (
              <div className="mt-5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-400)] mb-2">Step by step</div>
                <ol className="space-y-3">
                  {s.steps.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--color-accent-50)] text-[var(--color-accent-700)] text-[11px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                      <div>
                        <div className="text-[13px] font-semibold text-[var(--color-ink-800)]">{step.title}</div>
                        <div className="text-[12.5px] text-[var(--color-ink-500)] mt-0.5 leading-relaxed">{step.detail}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {s.note && (
              <div className="mt-5 rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 text-[12.5px] text-amber-800 leading-relaxed">
                <span className="font-semibold">Note — </span>{s.note}
              </div>
            )}

            {s.crossRefs && s.crossRefs.length > 0 && (
              <div className="mt-5 pt-4 hairline-t flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-400)]">See also</span>
                {s.crossRefs.map((ref) => {
                  const target = GUIDE_SECTIONS.find((x) => x.number === ref);
                  return (
                    <a key={ref} href={`#section-${ref}`} className="text-[12px] text-[var(--color-accent-600)] hover:underline">
                      {ref}{target ? ` · ${target.title}` : ""}
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
