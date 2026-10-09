import Link from "next/link"
import { UnpublishedPill } from "@/components/UnpublishedPill"
import { AppSwitcher, type SwitchableApp } from "@/components/AppSwitcher"

/**
 * ONE shell for both scopes — the org matrix and the per-app control plane.
 *
 * This replaces a separate `OrgShell` and `AppShell`. The split seemed right (the two sidebars
 * answer different questions) but it made the two halves of the product feel like two products:
 * from inside an app there was no way to reach Members, and no way to reach another app without
 * going back to the root. PayCraft's dashboard puts both in a single layout with an app switcher
 * at the top, and that is the structure adopted here.
 *
 * What is NOT adopted is PayCraft's active-app COOKIE. It serves `/products` and resolves the app
 * server-side, which is tidier to look at but means the URL does not identify what you are
 * looking at: two tabs on two apps fight over one cookie, and a link to an app's parameters is
 * not a link to an app's parameters. This dashboard keeps `/apps/{id}/…` and the switcher simply
 * navigates.
 *
 * The nav is grouped by VERB rather than listed flat — configure, then observe, then ship. Eight
 * undifferentiated links is a list you re-read every time; three short groups is one you learn.
 */

type NavItem = { href: string; icon: string; label: string; badge?: string | number | null }

export type AppContext = {
  id: string
  name: string
  liveVersion: number | null
  stagedCount: number
  /** The sub-route the switcher should preserve when moving to another app; null at the root. */
  section: string | null
}

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} aria-hidden>{name}</span>
}

function Group({ title, items, active }: { title: string; items: NavItem[]; active: string }) {
  return (
    <>
      <p className="px-3 pb-1 pt-3 text-[11px] font-medium tracking-wide text-secondary first:pt-0">
        {title}
      </p>
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
    </>
  )
}

export function Shell({
  active,
  userEmail,
  apps,
  app,
  children,
}: {
  active: string
  userEmail: string | null
  apps: SwitchableApp[]
  /** Present on `/apps/{id}/…` routes; absent at org level. */
  app?: AppContext
  children: React.ReactNode
}) {
  const workspace: NavItem[] = [
    { href: "/dashboard", icon: "grid_view", label: "Dashboard" },
    { href: "/apps", icon: "apps", label: "Apps", badge: apps.length },
    { href: "/community", icon: "deployed_code", label: "Community templates" },
  ]

  // Only built pages are listed. The audit log and billing are specified but do not exist, and
  // a sidebar entry that 404s is worse than an absent one — it reads as a broken product rather
  // than an unfinished one.
  //
  // Access Tokens sits here rather than beside an app's Keys page because the two credentials
  // belong at different levels: a publishable key is per-app and public, an access token is
  // per-user and secret.
  const adminItems: NavItem[] = [
    { href: "/account/tokens", icon: "key_vertical", label: "Access Tokens" },
    { href: "/admin/members", icon: "group", label: "Members" },
  ]

  return (
    <div className="flex h-screen overflow-hidden bg-surface_variant">
      <aside className="flex w-64 flex-shrink-0 select-none flex-col border-r border-outline_variant bg-surface">
        <div className="flex h-16 items-center gap-2.5 border-b border-outline_variant px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold tracking-tight text-on_primary shadow-sm">
            rc
          </div>
          <Link href="/dashboard" className="font-headline text-lg font-bold tracking-tight">
            rconfig
          </Link>
        </div>

        {app && (
          <div className="border-b border-outline_variant/70 bg-surface_variant/40 px-3 py-2.5">
            <div className="mb-1 flex items-center justify-between px-2 text-xs text-secondary">
              <span className="font-medium tracking-wide">APP</span>
              <span className="flex items-center gap-1 font-mono text-[11px] font-semibold text-tertiary">
                <span className="h-1.5 w-1.5 rounded-full bg-tertiary" />
                {app.liveVersion ? `v${app.liveVersion}` : "unpublished"}
              </span>
            </div>
            <AppSwitcher apps={apps} activeId={app.id} section={app.section} />
          </div>
        )}

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {app ? (
            <>
              <Group
                title="CONFIGURE"
                active={active}
                items={[
                  { href: `/apps/${app.id}/parameters`, icon: "tune", label: "Parameters" },
                  { href: `/apps/${app.id}/conditions`, icon: "rule", label: "Conditions" },
                  { href: `/apps/${app.id}/configs`, icon: "layers", label: "Configs" },
                  { href: `/apps/${app.id}/templates`, icon: "dashboard_customize", label: "Templates" },
                ]}
              />
              <Group
                title="VERIFY"
                active={active}
                items={[
                  { href: `/apps/${app.id}/preview`, icon: "preview", label: "Preview" },
                  { href: `/apps/${app.id}/history`, icon: "history", label: "Activity" },
                ]}
              />
              <Group
                title="SHIP"
                active={active}
                items={[
                  {
                    href: `/apps/${app.id}/publish`,
                    icon: "rocket_launch",
                    label: "Publish",
                    badge: app.stagedCount || null,
                  },
                  { href: `/apps/${app.id}/keys`, icon: "key", label: "Keys" },
                ]}
              />
              <Group
                title="WORKSPACE"
                active={active}
                items={[
                  { href: "/dashboard", icon: "grid_view", label: "Dashboard" },
                  { href: "/community", icon: "deployed_code", label: "Community templates" },
                ]}
              />
            </>
          ) : (
            <Group title="WORKSPACE" active={active} items={workspace} />
          )}
        </nav>

        {/* Bottom-left, below a divider — separated by PLACEMENT, not only by a heading. These are
            rare and account-wide; they must never sit beside the per-app rows an operator reaches
            for daily. */}
        <div className="border-t border-outline_variant px-3 py-3">
          <Group title="ADMIN" active={active} items={adminItems} />
        </div>

        {userEmail && (
          <div className="flex items-center gap-2.5 border-t border-outline_variant px-5 py-3">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-secondary_container text-xs font-semibold text-on_secondary_container">
              {userEmail.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 truncate text-xs text-secondary">{userEmail}</span>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 flex-shrink-0 items-center justify-between gap-4 border-b border-outline_variant bg-surface px-6">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            {app ? (
              <>
                <Link href="/dashboard" className="flex-shrink-0 text-secondary hover:text-on_surface">
                  Apps
                </Link>
                <Icon name="chevron_right" className="flex-shrink-0 text-[16px] text-outline" />
                <Link href={`/apps/${app.id}`} className="truncate font-semibold hover:underline">
                  {app.name}
                </Link>
                <Icon name="chevron_right" className="flex-shrink-0 text-[16px] text-outline" />
                <span className="truncate text-secondary">{active}</span>
              </>
            ) : (
              <>
                <span className="flex-shrink-0 font-mono text-[11px] uppercase tracking-wider text-secondary">
                  Scope
                </span>
                <Icon name="chevron_right" className="flex-shrink-0 text-[16px] text-outline" />
                <span className="truncate font-semibold">{active}</span>
              </>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-3">
            {/* Not a switcher — there is one environment. A dropdown that cannot switch promises
                a capability the product does not have. */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-tertiary_container bg-tertiary_container px-2.5 py-1 text-xs font-medium text-on_tertiary_container">
              <span className="h-1.5 w-1.5 rounded-full bg-tertiary" />
              Production
            </span>
            {app && <UnpublishedPill appId={app.id} count={app.stagedCount} />}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
