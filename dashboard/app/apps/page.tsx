export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { loadFleet } from "@/lib/fleet"
import { Shell } from "@/components/Shell"

/**
 * The apps LIST, as distinct from the dashboard matrix.
 *
 * The matrix compares apps across dimensions; this is for picking one. Keeping both is not
 * duplication — a column of counts is the wrong shape for "open the thing I came for", and a
 * list of names is the wrong shape for "which app has unpublished changes".
 */
export default async function AppsPage() {
  const { user, supabase } = await requireUser()
  const fleet = await loadFleet(supabase)

  return (
    <Shell userEmail={user.email ?? null} apps={fleet}>
      <div className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">Apps</h1>
            <p className="mt-1 text-sm text-secondary">
              Each app has its own parameters, conditions, keys and release history. Nothing is
              shared between them.
            </p>
          </div>
          <Link href="/onboarding"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-on_primary">
            New app
          </Link>
        </div>

        {fleet.length === 0 && (
          // Previously this page redirected to the wizard, which meant a zero-app operator
          // could not reach it at all — same trap as the dashboard had.
          <div className="mt-6 rounded-lg border border-dashed border-outline_variant bg-surface p-10 text-center">
            <p className="text-sm font-medium">No apps registered</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-secondary">
              Registering an app issues its publishable key and gives it somewhere to hold
              parameters and configs.
            </p>
            <Link
              href="/onboarding"
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-on_primary"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden>add</span>
              Add an app
            </Link>
          </div>
        )}

        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fleet.map((a) => (
            <li key={a.id}>
              <Link href={`/apps/${a.id}/parameters`} data-testid="app-card"
                className="block rounded-lg border border-outline_variant bg-surface p-4 transition-colors hover:border-primary">
                <p className="font-semibold">{a.display_name}</p>
                <p className="font-mono text-[11px] text-secondary">{a.slug}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {a.platforms.map((p) => (
                    <span key={p} className="rounded bg-surface_variant px-1.5 py-0.5 font-mono text-[10px] text-on_surface_variant">
                      {p}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-secondary">{a.parameters} params · {a.keys} keys</span>
                  {a.liveVersion
                    ? <span className="rounded-full bg-tertiary_container px-2 py-0.5 font-mono text-[10px] font-semibold text-on_tertiary_container">v{a.liveVersion}</span>
                    : <span className="text-secondary">never published</span>}
                </div>
                {a.unpublished > 0 && (
                  <p className="mt-2 rounded border border-warning/30 bg-warning_container px-2 py-1 text-[11px] font-medium text-on_warning_container">
                    {a.unpublished} unpublished {a.unpublished === 1 ? "change" : "changes"}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Shell>
  )
}
