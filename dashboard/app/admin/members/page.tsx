export const runtime = "edge"

import { requireUser } from "@/lib/require-user"
import { loadAppList } from "@/lib/fleet"
import { Shell } from "@/components/Shell"

type MemberRow = { user_id: string; role: string; app_id: string }

/**
 * Members, from mockup 08.
 *
 * Membership is PER APP in this schema — `app_member(app_id, user_id, role)` — so "account
 * members" is a derived view: one row per person, with the apps they can reach. Presenting it
 * as a flat account roster would imply an account-wide role that does not exist, and an
 * operator would reasonably expect changing it to apply everywhere.
 */
export default async function MembersPage() {
  const { user, supabase } = await requireUser()
  const fleet = await loadAppList(supabase)

  const { data } = await supabase.from("app_member").select("user_id, role, app_id")
  const rows = (data ?? []) as MemberRow[]

  const byUser = new Map<string, { roles: Set<string>; apps: Set<string> }>()
  for (const r of rows) {
    const e = byUser.get(r.user_id) ?? { roles: new Set<string>(), apps: new Set<string>() }
    e.roles.add(r.role)
    e.apps.add(r.app_id)
    byUser.set(r.user_id, e)
  }

  return (
    <Shell userEmail={user.email ?? null} apps={fleet}>
      <div className="p-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Members</h1>
        <p className="mt-1 max-w-2xl text-sm text-secondary">
          Access is granted per app, not per account. Someone can be an owner of one app and have
          no access to another — which is why this page lists the apps each person can reach
          rather than a single account-wide role.
        </p>

        <section className="mt-6 overflow-hidden rounded-lg border border-outline_variant bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-outline_variant bg-surface_variant/50 text-[11px] uppercase tracking-wide text-secondary">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Person</th>
                <th className="px-5 py-2.5 font-semibold">Roles held</th>
                <th className="px-5 py-2.5 font-semibold">Apps</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline_variant">
              {[...byUser.entries()].map(([userId, e]) => (
                <tr key={userId} data-testid="member-row">
                  <td className="px-5 py-3">
                    {/* Only the signed-in user's own address is known here: auth.users is not
                        readable through RLS, and exposing a lookup of it from the client would
                        be an email-enumeration surface. Other members show by id until an
                        invite flow records a display name. */}
                    {userId === user.id
                      ? <span className="font-medium">{user.email}</span>
                      : <span className="font-mono text-xs text-secondary">{userId.slice(0, 8)}…</span>}
                    {userId === user.id && (
                      <span className="ml-2 rounded bg-primary_container px-1.5 py-0.5 text-[10px] font-semibold text-on_primary_container">
                        you
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className="flex flex-wrap gap-1">
                      {[...e.roles].map((r) => (
                        <span key={r} className="rounded bg-surface_variant px-1.5 py-0.5 font-mono text-[10px] text-on_surface_variant">
                          {r}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-on_surface_variant">{e.apps.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="mt-6 flex gap-3 rounded-lg border border-outline_variant bg-surface p-4 text-sm text-on_surface_variant">
          <span className="material-symbols-outlined text-[20px] text-primary" aria-hidden>info</span>
          <p>
            <strong className="font-semibold text-on_surface">Why admin lives down here.</strong>{" "}
            Members, the audit log, API access and billing are account-wide and some are
            irreversible. Keeping them in a separate bottom-left group means someone reaching for
            Parameters never lands on Billing by muscle memory.
          </p>
        </div>
      </div>
    </Shell>
  )
}
