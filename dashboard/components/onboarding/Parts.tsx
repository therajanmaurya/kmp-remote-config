"use client"

import { useState } from "react"

/** A titled panel — the recurring container in mockups 08 and 09. */
export function Panel({
  title, subtitle, aside, children,
}: {
  title: string
  subtitle?: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-outline_variant bg-surface">
      <header className="flex items-start justify-between gap-4 border-b border-outline_variant px-5 py-3.5">
        <div>
          <h2 className="font-headline text-sm font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-secondary">{subtitle}</p>}
        </div>
        {aside}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

/** The large selectable option card, with the RECOMMENDED badge from mockup 08. */
export function ChoiceCard({
  selected, onSelect, title, body, recommended, testId,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  body: string
  recommended?: boolean
  testId: string
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors ${
        selected ? "border-primary bg-primary_container/40" : "border-outline_variant hover:border-outline"
      }`}
    >
      <input
        type="radio"
        name="idmode"
        data-testid={testId}
        checked={selected}
        onChange={onSelect}
        className="mt-1"
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <strong className="text-sm font-semibold">{title}</strong>
          {recommended && (
            <span className="rounded bg-primary px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-on_primary">
              Recommended
            </span>
          )}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-secondary">{body}</span>
      </span>
    </label>
  )
}

/** An amber caution — used for the keytool SHA-1 warning and the test-key note. */
export function Caution({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning_container/60 px-3.5 py-3">
      <span className="material-symbols-outlined text-[18px] text-warning" aria-hidden>info</span>
      <p className="text-xs leading-relaxed text-on_warning_container">{children}</p>
    </div>
  )
}

/**
 * Copy-to-clipboard. Confirms by swapping its own label rather than raising a toast: the
 * operator is looking at the thing they just copied, so that is where the acknowledgement
 * belongs.
 */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1600)
        } catch {
          // Clipboard is permission-gated and absent over plain http. The key is on screen
          // and selectable, so a failure costs nothing but the shortcut.
        }
      }}
      className="inline-flex items-center gap-1 rounded border border-outline_variant px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-secondary hover:border-outline hover:text-on_surface"
    >
      <span className="material-symbols-outlined text-[13px]" aria-hidden>{done ? "check" : "content_copy"}</span>
      {done ? "Copied" : label}
    </button>
  )
}

/** A dark code panel with a copy affordance, as in mockup 09. */
export function CodePanel({ caption, code }: { caption: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-outline_variant">
      <div className="flex items-center justify-between gap-3 border-b border-outline_variant bg-surface_variant/60 px-3 py-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-secondary">{caption}</span>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto bg-code_background p-4 font-mono text-[11px] leading-relaxed text-code_on_background">
        {code}
      </pre>
    </div>
  )
}
