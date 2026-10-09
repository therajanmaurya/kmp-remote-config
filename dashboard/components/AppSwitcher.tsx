"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { switchHref } from "@/lib/app-section"

export type SwitchableApp = { id: string; display_name: string; slug: string }

/**
 * Move between apps without returning to a list — the pattern PayCraft's dashboard uses, and
 * the gap this dashboard had: the sidebar named the current app but could not change it.
 *
 * **It NAVIGATES rather than setting an active-app cookie**, which is where this deliberately
 * diverges from PayCraft. A cookie gives shorter URLs and suits one merchant with one app, but
 * it breaks two things a config operator actually does: comparing two apps in two tabs (they
 * would fight over one cookie) and sending someone a link to a specific app's parameters.
 * Keeping the app in the URL costs a path segment and buys both.
 *
 * The current SECTION is preserved across the switch — on Conditions for app A you land on
 * Conditions for app B — because the reason to switch is almost always to compare the same
 * thing.
 */
export function AppSwitcher({
  apps,
  activeId,
  section,
}: {
  apps: SwitchableApp[]
  activeId: string
  /** e.g. "parameters" — the sub-route to preserve; null at the app root. */
  section: string | null
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = apps.find((a) => a.id === activeId)

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onOutside)
    document.addEventListener("keydown", onEscape)
    return () => {
      document.removeEventListener("mousedown", onOutside)
      document.removeEventListener("keydown", onEscape)
    }
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        data-testid="app-switcher"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface_variant"
      >
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-primary_container text-[10px] font-bold text-on_primary_container">
          {(active?.display_name ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {active?.display_name ?? "Select app"}
        </span>
        <span className="material-symbols-outlined flex-shrink-0 text-[16px] text-secondary" aria-hidden>
          unfold_more
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-outline_variant bg-surface shadow-lg"
        >
          <p className="border-b border-outline_variant px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-secondary">
            Your apps
          </p>
          <ul className="max-h-64 overflow-y-auto py-1">
            {apps.map((a) => (
              <li key={a.id}>
                <Link
                  role="menuitem"
                  data-testid="switcher-app"
                  href={switchHref(a.id, section)}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface_variant"
                >
                  <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden>
                    {a.id === activeId ? "check" : "radio_button_unchecked"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.display_name}</span>
                    <span className="block truncate font-mono text-[10px] text-secondary">{a.slug}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t border-outline_variant">
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-on_surface_variant hover:bg-surface_variant"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden>grid_view</span>
              All apps
            </Link>
            <Link
              href="/onboarding"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-primary hover:bg-surface_variant"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden>add</span>
              New app
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
