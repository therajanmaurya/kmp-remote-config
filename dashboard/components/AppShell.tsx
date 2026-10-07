import Link from "next/link"
import { UnpublishedPill } from "@/components/UnpublishedPill"

/**
 * The dashboard shell from the generated mockups: a fixed 64-unit sidebar for the control
 * plane, and a top bar carrying the environment, the unpublished-changes pill and the publish
 * action.
 *
 * The sidebar is the reason this exists. The previous layout put every page in a bare centred
 * column with a back-link, so moving between parameters, conditions and configs meant
 * returning to the app page each time — and nothing on screen told an operator the other
 * surfaces existed at all.
 */

type NavItem = { href: string; icon: string; label: string; badge?: string | number | null }

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} aria-hidden>{name}</span>
}

export function AppShell({
  appId,
  appName,
  active,
  liveVersion,
  stagedCount,
  children,
}: {
  appId: string
  appName: string
  active: string
  liveVersion: number | null
  stagedCount: number
  children: React.ReactNode
}) {
  const control: NavItem[] = [
    { href: `/apps/${appId}/parameters`, icon: "tune", label: "Parameters" },
    { href: `/apps/${appId}/conditions`, icon: "rule", label: "Conditions" },
    { href: `/apps/${appId}/configs`, icon: "layers", label: "Configs" },
    { href: `/apps/${appId}/templates`, icon: "dashboard_customize", label: "Templates" },
    { href: `/apps/${appId}/keys`, icon: "key", label: "Keys" },
    { href: `/apps/${appId}/preview`, icon: "preview", label: "Preview" },
    { href: `/apps/${appId}/history`, icon: "history", label: "Activity" },
  ]

  return (
    <div className="flex h-screen overflow-hidden bg-surface_variant">
      <aside className="flex w-64 flex-shrink-0 select-none flex-col border-r border-outline_variant bg-surface">
        <div className="flex h-16 items-center gap-2.5 border-b border-outline_variant px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold tracking-tight text-on_primary shadow-sm">
            rc
          </div>
          <Link href="/" className="font-headline text-lg font-bold tracking-tight">rconfig</Link>
        </div>

        <div className="border-b border-outline_variant/70 bg-surface_variant/40 px-4 py-3">
          <div className="mb-1 flex items-center justify-between text-xs text-secondary">
            <span className="font-medium tracking-wide">ORGANIZATION</span>
            <span className="flex items-center gap-1 font-mono text-[11px] font-semibold text-tertiary">
              <span className="h-1.5 w-1.5 rounded-full bg-tertiary" />
              {liveVersion ? `v${liveVersion}` : "unpublished"}
            </span>
          </div>
          <div className="flex items-center gap-2 truncate">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-primary_container text-xs font-semibold text-on_primary_container">
              {appName.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-sm font-semibold">{appName}</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-secondary">CONTROL PLANE</p>
          {control.map((item) => {
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
                {item.badge != null && (
                  <span className="rounded bg-primary/10 px-1.5 font-mono text-[11px] font-semibold text-primary">
                    {item.badge}
                  </span>
                )}
              </Link>
            )
          })}

          <p className="px-3 pb-1 pt-4 text-[11px] font-medium tracking-wide text-secondary">RESOURCES</p>
          <Link
            href="/community"
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-on_surface_variant transition-colors hover:bg-surface_variant hover:text-on_surface"
          >
            <Icon name="deployed_code" className="text-[19px]" />
            Community templates
          </Link>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 flex-shrink-0 items-center justify-between gap-4 border-b border-outline_variant bg-surface px-6">
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <Link href="/" className="text-secondary hover:text-on_surface">Apps</Link>
            <Icon name="chevron_right" className="text-[16px] text-outline" />
            <Link href={`/apps/${appId}`} className="truncate font-semibold hover:underline">{appName}</Link>
            <Icon name="chevron_right" className="text-[16px] text-outline" />
            <span className="truncate text-secondary">{active}</span>
          </div>

          <div className="flex flex-shrink-0 items-center gap-3">
            {/* The environment chip is not a switcher yet — there is one environment. Showing a
                dropdown that cannot switch would promise a capability the product lacks. */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-tertiary_container bg-tertiary_container px-2.5 py-1 text-xs font-medium text-on_tertiary_container">
              <span className="h-1.5 w-1.5 rounded-full bg-tertiary" />
              Production
            </span>
            <UnpublishedPill appId={appId} count={stagedCount} />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
