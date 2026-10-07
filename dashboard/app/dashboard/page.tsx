export const runtime = "edge"

import Link from "next/link"
import { redirect } from "next/navigation"
import { requireUser } from "@/lib/require-user"
import { loadFleet } from "@/lib/fleet"
import { OrgShell } from "@/components/OrgShell"

export default async function DashboardPage() {
  const { user, supabase } = await requireUser()
  const fleet = await loadFleet(supabase)

  // Nothing registered yet: onboarding, not a matrix with no rows. A table whose only content
  // is an empty state is a worse first screen than the flow that fixes it.
  if (fleet.length === 0) redirect("/onboarding")

  const totals = {
    apps: fleet.length,
    parameters: fleet.reduce((n, a) => n + a.parameters, 0),
    revisions: fleet.reduce((n, a) => n + (a.liveVersion ?? 0), 0),
    keys: fleet.reduce((n, a) => n + a.keys, 0),
  }

  return (
    <OrgShell active="Dashboard" userEmail={user.email ?? null} appCount={fleet.length}>
      <div className="p-6">
        <div className="rounded-lg bg-primary p-6 text-on_primary">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-on_primary/70">
            Organisation overview
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">
            {totals.apps} {totals.apps === 1 ? "app" : "apps"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-on_primary/80">
            Every app in this account, side by side. Open one to manage its parameters,
            conditions and releases.
          </p>
        </div>

        {/* Counts only. The mockup also showed total evaluations, edge latency and an
            attestation posture score — none has a data source, and a fabricated figure beside
            a real one teaches an operator to distrust both. */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Apps", value: String(totals.apps) },
            { label: "Parameters", value: String(totals.parameters), hint: "across every app" },
            { label: "Published revisions", value: String(totals.revisions) },
            { label: "Active keys", value: String(totals.keys), hint: "not revoked" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-outline_variant bg-surface p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-secondary">{s.label}</p>
              <p className="mt-2 font-display text-2xl font-bold tracking-tight">{s.value}</p>
              {s.hint && <p className="mt-1 text-xs text-secondary">{s.hint}</p>}
            </div>
          ))}
        </div>

        <section className="mt-6 overflow-hidden rounded-lg border border-outline_variant bg-surface">
          <header className="flex items-center justify-between gap-4 border-b border-outline_variant px-5 py-3">
            <h2 className="font-headline text-sm font-semibold">Apps</h2>
            <Link href="/onboarding"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-on_primary">
              New app
            </Link>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-outline_variant bg-surface_variant/50 text-[11px] uppercase tracking-wide text-secondary">
                <tr>
                  <th className="px-5 py-2.5 font-semibold">App</th>
                  <th className="px-5 py-2.5 font-semibold">Platforms</th>
                  <th className="px-5 py-2.5 font-semibold">Params</th>
                  <th className="px-5 py-2.5 font-semibold">Conditions</th>
                  <th className="px-5 py-2.5 font-semibold">Configs</th>
                  <th className="px-5 py-2.5 font-semibold">Live</th>
                  <th className="px-5 py-2.5 font-semibold">Unpublished</th>
                  <th className="px-5 py-2.5 font-semibold">Keys</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline_variant">
                {fleet.map((a) => (
                  <tr key={a.id} data-testid="fleet-row" className="hover:bg-surface_variant/40">
                    <td className="px-5 py-3">
                      <Link href={`/apps/${a.id}/parameters`} className="font-medium text-primary hover:underline">
                        {a.display_name}
                      </Link>
                      <p className="font-mono text-[11px] text-secondary">{a.slug}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className="flex flex-wrap gap-1">
                        {a.platforms.map((p) => (
                          <span key={p} className="rounded bg-surface_variant px-1.5 py-0.5 font-mono text-[10px] text-on_surface_variant">
                            {p}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-on_surface_variant">{a.parameters}</td>
                    <td className="px-5 py-3 text-on_surface_variant">{a.conditions}</td>
                    <td className="px-5 py-3 text-on_surface_variant">{a.configs}</td>
                    <td className="px-5 py-3">
                      {/* The column to scan first: an app that has never published serves
                          NOTHING to devices, however many parameters it holds. */}
                      {a.liveVersion ? (
                        <span className="rounded-full bg-tertiary_container px-2 py-0.5 font-mono text-[11px] font-semibold text-on_tertiary_container">
                          v{a.liveVersion}
                        </span>
                      ) : (
                        <span className="text-xs text-secondary">never published</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {a.unpublished > 0 ? (
                        <Link href={`/apps/${a.id}/publish`}
                          className="rounded-full border border-warning/30 bg-warning_container px-2 py-0.5 text-[11px] font-semibold text-on_warning_container">
                          {a.unpublished}
                        </Link>
                      ) : (
                        <span className="text-secondary">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-on_surface_variant">{a.keys}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-6 flex gap-3 rounded-lg border border-outline_variant bg-surface p-4 text-sm text-on_surface_variant">
          <span className="material-symbols-outlined text-[20px] text-primary" aria-hidden>info</span>
          <p>
            An app whose <strong className="font-semibold text-on_surface">Live</strong> column reads
            &ldquo;never published&rdquo; is serving nothing to devices, however many parameters it
            has. Publishing is per app — there is no account-wide publish, deliberately.
          </p>
        </div>
      </div>
    </OrgShell>
  )
}
