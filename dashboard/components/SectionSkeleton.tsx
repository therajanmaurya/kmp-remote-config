/**
 * What the content area shows while a section loads.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────
 * There were no `loading.tsx` files and no Suspense boundaries anywhere in the app. In the App
 * Router that is not merely a missing nicety: the router keeps the CURRENT page on screen until
 * the next route's payload arrives, so with nothing to suspend into, clicking a sidebar entry
 * left the previous section sitting there, unchanged, for the length of a full server render.
 * The product read as unresponsive rather than slow — people clicked twice, assuming the first
 * click had missed.
 *
 * It also disabled prefetching. `<Link>` prefetches by default, but for a dynamic route the
 * router can only render ahead as far as the nearest loading boundary; with none, the prefetch
 * traffic still went out and bought nothing.
 *
 * ── Why a travelling shimmer and not `animate-pulse` ────────────────────────────────────────
 * `animate-pulse` fades opacity between 1 and ~0.5. On a single element that reads as "busy",
 * but on a FIRST load — where the entire screen is placeholder and every block pulses in
 * lockstep — it reads as a page that rendered wrong, because nothing moves and the whole view
 * dims together. A highlight band travelling left to right has direction, which is what makes
 * it legible as work in progress rather than as a broken render.
 *
 * The bars are deliberately staggered (`animationDelay`) so they do not sweep as one slab —
 * synchronised motion is the same lockstep problem in a different form.
 *
 * Deliberately a shape, not a spinner: matching the rough layout of the page that follows means
 * the content lands in space already reserved for it, instead of the page jumping once it
 * arrives.
 */

/** One shimmering placeholder bar. `delay` staggers it against its neighbours. */
function Bar({ className = "", delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div
      className={`animate-shimmer rounded bg-[length:200%_100%] bg-gradient-to-r from-surface_variant via-outline_variant/60 to-surface_variant ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    />
  )
}

export function SectionSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-6 p-8" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Bar className="h-7 w-56" />
        <Bar className="h-4 w-80" delay={90} />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-lg border border-outline_variant p-4"
          >
            <div className="space-y-2">
              <Bar className="h-4 w-48" delay={i * 110} />
              <Bar className="h-3 w-32" delay={i * 110 + 60} />
            </div>
            <Bar className="h-8 w-20" delay={i * 110 + 120} />
          </div>
        ))}
      </div>
    </div>
  )
}
