"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

export type NavItem = {
  href: string
  icon: string
  label: string
  badge?: string | number | null
}

export type NavGroup = { title: string; items: NavItem[] }

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} aria-hidden>{name}</span>
}

/**
 * The sidebar, with the active row resolved on the CLIENT.
 *
 * ── Why this is a client component ──────────────────────────────────────────────────────────
 * The highlight used to be computed in `apps/[id]/layout.tsx`, which read `headers()` to get the
 * pathname and passed an `active` label down. That one read made the layout's output a function
 * of the URL — and a layout whose output depends on the URL cannot be reused when you navigate
 * between its own children. Every move from Configs to Keys re-ran the whole layout: an auth
 * validation plus three queries (`app`, publish status, the app list), none of whose answers had
 * changed, before the section you asked for began loading.
 *
 * Deriving it here from `usePathname()` costs a few kilobytes of JS and makes the layout
 * pathname-independent, which is the precondition for the router reusing it at all (see
 * `staleTimes` in next.config.mjs).
 *
 * ── Longest-prefix, not label equality ──────────────────────────────────────────────────────
 * The old comparison was `active === item.label`, which needed the server to have already
 * decided the label. Matching the URL directly is both simpler and more robust, but it has to be
 * LONGEST-prefix across every group at once: `/apps/1/keys` is prefixed by `/apps/1` as well, so
 * a first-match rule would light up the wrong row the moment an app-root entry is added back to
 * the nav. Resolving globally also keeps exactly one row highlighted, which per-group matching
 * cannot promise.
 */
export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname() ?? ""

  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <>
      {groups.map((group) => (
        <div key={group.title} className="contents">
          <p className="px-3 pb-1 pt-3 text-[11px] font-medium tracking-wide text-secondary first:pt-0">
            {group.title}
          </p>
          {group.items.map((item) => {
            const on = item.href === activeHref
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  on
                    ? "bg-primary_container text-on_primary_container"
                    : "text-on_surface_variant hover:bg-surface_variant hover:text-on_surface"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon name={item.icon} className={`text-[19px] ${on ? "text-primary" : ""}`} />
                  {item.label}
                </span>
                {item.badge != null && item.badge !== 0 && (
                  <span className="rounded bg-primary/10 px-1.5 font-mono text-[11px] font-semibold text-primary">
                    {item.badge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}
    </>
  )
}
