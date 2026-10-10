export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { loadFleet, fleetTotals } from "@/lib/fleet"
import { Shell } from "@/components/Shell"

/**
 * The organisation dashboard — the landing view for every signed-in operator, with apps or
 * without.
 *
 * It used to REDIRECT a zero-app account to /onboarding, on the reasoning that a table with no
 * rows is a poor first screen. That was wrong in a way only using it reveals: the redirect was
 * unconditional, so a new operator could not reach the dashboard AT ALL — not to read what the
 * product does, not to find the admin section, not even to leave the wizard without using the
 * browser's back button. Onboarding is now something you LAUNCH from here, not a wall in front
 * of here.
 *
 * Signed-out is handled one layer up by `requireUser()`, which sends you to the login page. The
 * three states are therefore: signed out → login · signed in with no apps → this page's empty
 * state · signed in with apps → the matrix.
 */
export default async function DashboardPage() {
  const { user, supabase } = await requireUser()
  const fleet = await loadFleet(supabase)
  const totals = fleetTotals(fleet)
  const empty = fleet.length === 0

  return (
    <Shell userEmail={user.email ?? null} apps={fleet}>
      <div className="p-6">
        <div className="rounded-lg bg-primary p-6 text-on_primary">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-on_primary/70">
            Organisation overview
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">
            {empty ? "No apps yet" : `${totals.apps} ${totals.apps === 1 ? "app" : "apps"}`}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-on_primary/80">
            {empty
              ? "Register an app to get a publishable key, then ship parameters and server-driven UI to it without a release. Takes about a minute."
              : "Every app in this account, side by side. Open one to manage its parameters, conditions and releases."}
          </p>
          {empty && (
            <Link
              href="/onboarding"
              data-testid="empty-add-app"
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-on_primary px-4 py-2 text-sm font-semibold text-primary"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden>add</span>
              Add your first app
            </Link>
          )}
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
                {empty && (
                  <tr>
                    {/* A headed table with nothing under it reads as a failed load. Say what
                        belongs here and how to put it there. */}
                    <td colSpan={8} className="px-5 py-10 text-center">
                      <p className="text-sm font-medium">No apps registered</p>
                      <p className="mx-auto mt-1 max-w-md text-sm text-secondary">
                        Each app gets its own publishable key, parameters and release history.
                        Nothing is shared between them.
                      </p>
                      <Link
                        href="/onboarding"
                        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-on_primary"
                      >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden>add</span>
                        Add an app
                      </Link>
                    </td>
                  </tr>
                )}
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

        {!empty && (
        <div className="mt-6 flex gap-3 rounded-lg border border-outline_variant bg-surface p-4 text-sm text-on_surface_variant">
          <span className="material-symbols-outlined text-[20px] text-primary" aria-hidden>info</span>
          <p>
            An app whose <strong className="font-semibold text-on_surface">Live</strong> column reads
            &ldquo;never published&rdquo; is serving nothing to devices, however many parameters it
            has. Publishing is per app — there is no account-wide publish, deliberately.
          </p>
        </div>
        )}
      </div>
    </Shell>
  )
}
