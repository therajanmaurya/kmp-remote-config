/**
 * The page furniture from the mockups: an indigo hero band, a row of stat cards, and the
 * section/table treatment every control-plane screen shares.
 *
 * Shared rather than repeated per page so the screens stay consistent as they are added —
 * the mockups are one design, and four pages each approximating it is how a design system
 * dies.
 */

export function Hero({
  eyebrow, title, subtitle, aside,
}: {
  eyebrow: string
  title: string
  subtitle: string
  aside?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-6 rounded-lg bg-primary p-6 text-on_primary md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-on_primary/70">
          {eyebrow}
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-on_primary/80">{subtitle}</p>
      </div>
      {aside && <div className="flex-shrink-0 text-right">{aside}</div>}
    </div>
  )
}

/**
 * Every stat here is a COUNT this page already queried. The mockups also showed latency
 * percentiles, client-evaluation totals and a reliability figure — those are omitted rather
 * than invented, because a fabricated number rendered in the same card as a real one teaches
 * an operator to trust both.
 */
export function StatCards({ stats }: { stats: { label: string; value: string; hint?: string }[] }) {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg border border-outline_variant bg-surface p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-secondary">{s.label}</p>
          <p className="mt-2 font-display text-2xl font-bold tracking-tight">{s.value}</p>
          {s.hint && <p className="mt-1 text-xs text-secondary">{s.hint}</p>}
        </div>
      ))}
    </div>
  )
}

export function Panel({
  title, action, children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-outline_variant bg-surface">
      <header className="flex items-center justify-between gap-4 border-b border-outline_variant px-5 py-3">
        <h2 className="font-headline text-sm font-semibold">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-5 py-10 text-center text-sm text-secondary">{children}</p>
  )
}

export function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-secondary">
      {children}
    </th>
  )
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-surface_variant px-1.5 py-0.5 font-mono text-xs text-on_surface_variant">
      {children}
    </code>
  )
}

export function Button({
  children, type = "button", ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      {...rest}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-on_primary shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
    >
      {children}
    </button>
  )
}
