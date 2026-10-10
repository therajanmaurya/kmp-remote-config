import { SectionSkeleton } from "@/components/SectionSkeleton"

/**
 * The FIRST-LOAD boundary, and the reason the shimmer was barely visible before.
 *
 * The per-section `loading.tsx` files live INSIDE `apps/[id]/layout.tsx`, so they cannot paint
 * until that layout has resolved — and that layout is the expensive one (an auth validation plus
 * three queries). On a hard load the sequence was: blank page for the length of the layout, a
 * flash of skeleton, then content. The skeleton was working exactly as designed and almost never
 * seen, which is indistinguishable from it being broken.
 *
 * This boundary sits above every layout below the root, so a hard load paints immediately —
 * including a placeholder for the sidebar, which at this point has not been rendered yet and so
 * cannot supply its own.
 */
export default function RootLoading() {
  return (
    <div className="flex h-screen overflow-hidden bg-surface_variant" aria-busy="true">
      {/* The shell is not rendered yet on a cold load, so its shape is stood in for here. */}
      <aside className="flex w-64 flex-shrink-0 flex-col gap-2 border-r border-outline_variant bg-surface p-5">
        <div className="animate-shimmer mb-4 h-8 w-28 rounded bg-[length:200%_100%] bg-gradient-to-r from-surface_variant via-outline_variant/60 to-surface_variant" />
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="animate-shimmer h-8 w-full rounded bg-[length:200%_100%] bg-gradient-to-r from-surface_variant via-outline_variant/60 to-surface_variant"
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </aside>
      <main className="flex-1 overflow-y-auto bg-surface">
        <SectionSkeleton rows={5} />
      </main>
    </div>
  )
}
