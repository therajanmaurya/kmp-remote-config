/**
 * The three-step rail from mockups 07–09: numbered nodes joined by a rule, with a
 * "STEP n OF 3 · SETUP" eyebrow above it.
 *
 * A completed step shows a check rather than its number — the number is only useful while a
 * step is ahead of you, and swapping it for a tick is what makes the rail read as progress
 * instead of as a static legend.
 */
const STEPS = ["App", "Platforms and signing", "Integrate"] as const

export function Rail({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div>
      <p className="text-center font-mono text-[11px] font-semibold uppercase tracking-widest text-secondary">
        Step {step} of 3 · Setup
      </p>
      <ol className="mt-3 flex items-center justify-center gap-0">
        {STEPS.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3
          const done = step > n
          const active = step === n
          return (
            <li key={label} className="flex items-center">
              <span className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold ${
                    done
                      ? "bg-tertiary text-on_tertiary"
                      : active
                        ? "bg-primary text-on_primary"
                        : "border border-outline bg-surface text-secondary"
                  }`}
                >
                  {done ? "✓" : n}
                </span>
                <span className={`text-xs font-medium ${active || done ? "text-on_surface" : "text-secondary"}`}>
                  {label}
                </span>
              </span>
              {n < 3 && (
                <span className={`mx-3 h-px w-10 sm:w-16 ${step > n ? "bg-tertiary" : "bg-outline_variant"}`} />
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
