import Link from "next/link"

/**
 * The ORG-scoped shell, from mockup 07.
 *
 * Distinct from `AppShell` because the sidebar answers a different question. Inside an app the
 * nav is Parameters / Conditions / Configs; at org level none of those have a subject yet, so
 * offering them would be navigation to nothing.
 *
 * The ADMIN group sits at the BOTTOM, visually separated. That placement is the point: these
 * are rare, account-wide and some are irreversible, so they must never sit beside the
 * per-app actions an operator reaches for daily. Billing one row below Parameters is how
 * muscle memory ends up somewhere expensive.
 */

type Item = { href: string; icon: string; label: string; badge?: number | null }

function Nav({ items, active }: { items: Item[]; active: string }) {
  return (
    <>
      {items.map((item) => {
        const on = active === item.label
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
              <span className={`material-symbols-outlined text-[19px] ${on ? "text-primary" : ""}`} aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </span>
            {item.badge != null && item.badge > 0 && (
              <span className="rounded bg-primary/10 px-1.5 font-mono text-[11px] font-semibold text-primary">
                {item.badge}
              </span>
            )}
          </Link>
        )
      })}
    </>
  )
}

export function OrgShell({
  active,
  userEmail,
  appCount,
  children,
}: {
  active: string
  userEmail: string | null
  appCount: number
  children: React.ReactNode
}) {
  const workspace: Item[] = [
    { href: "/dashboard", icon: "grid_view", label: "Dashboard" },
    { href: "/apps", icon: "apps", label: "Apps", badge: appCount },
    { href: "/community", icon: "deployed_code", label: "Community templates" },
  ]

  const admin: Item[] = [
    { href: "/admin/members", icon: "group", label: "Members" },
    { href: "/admin/audit", icon: "receipt_long", label: "Audit log" },
    { href: "/admin/api", icon: "api", label: "API access" },
    { href: "/admin/billing", icon: "credit_card", label: "Billing" },
  ]

  return (
    <div className="flex h-screen overflow-hidden bg-surface_variant">
      <aside className="flex w-64 flex-shrink-0 select-none flex-col border-r border-outline_variant bg-surface">
        <div className="flex h-16 items-center gap-2.5 border-b border-outline_variant px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold text-on_primary shadow-sm">
            rc
          </div>
          <Link href="/dashboard" className="font-headline text-lg font-bold tracking-tight">rconfig</Link>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-secondary">WORKSPACE</p>
          <Nav items={workspace} active={active} />
        </nav>

        {/* Bottom-left, below a divider. Separated by placement, not just by a heading. */}
        <div className="border-t border-outline_variant px-3 py-3">
          <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-secondary">ADMIN</p>
          <Nav items={admin} active={active} />
        </div>

        {userEmail && (
          <div className="flex items-center gap-2.5 border-t border-outline_variant px-5 py-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary_container text-xs font-semibold text-on_secondary_container">
              {userEmail.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 truncate text-xs text-secondary">{userEmail}</span>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 flex-shrink-0 items-center justify-between gap-4 border-b border-outline_variant bg-surface px-6">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="font-mono text-[11px] uppercase tracking-wider text-secondary">Scope</span>
            <span className="material-symbols-outlined text-[16px] text-outline" aria-hidden>chevron_right</span>
            <span className="truncate font-semibold">{active}</span>
          </div>
          <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-tertiary_container bg-tertiary_container px-2.5 py-1 text-xs font-medium text-on_tertiary_container">
            <span className="h-1.5 w-1.5 rounded-full bg-tertiary" />
            Production
          </span>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
