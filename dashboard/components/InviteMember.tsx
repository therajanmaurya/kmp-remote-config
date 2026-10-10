"use client"

import { useState, useTransition } from "react"
import { inviteMember, revokeInvitation } from "@/app/admin/members/actions"

export type PendingInvitation = {
  id: string
  email: string
  role: string
  app_id: string
  expires_at: string
}

export type InvitableApp = { id: string; display_name: string }

/**
 * Invite someone, and see who has been invited and not yet arrived.
 *
 * Access in this schema is per APP, so an invitation names an app — there is no account-wide
 * "member". Presenting a single account-level invite would imply a role that does not exist and
 * would have to be invented at accept time.
 */
export function InviteMember({
  apps,
  pending,
}: {
  apps: InvitableApp[]
  pending: PendingInvitation[]
}) {
  const [email, setEmail] = useState("")
  const [appId, setAppId] = useState(apps[0]?.id ?? "")
  const [role, setRole] = useState("editor")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, start] = useTransition()

  const appName = (id: string) => apps.find((a) => a.id === id)?.display_name ?? "an app"

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    start(async () => {
      const r = await inviteMember({ appId, email, role })
      if (r.ok) {
        setEmail("")
        setMsg({ ok: true, text: `Invited ${r.email}. They get access the next time they sign in.` })
      } else {
        setMsg({ ok: false, text: r.error })
      }
    })
  }

  if (apps.length === 0) {
    return (
      <p className="mt-6 rounded border border-dashed border-outline_variant p-6 text-sm text-secondary">
        You need an app before you can invite anyone to it — access is granted per app.
      </p>
    )
  }

  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold">Invite someone</h2>
      <p className="mt-1 max-w-2xl text-sm text-secondary">
        They sign in with this address and the access is there waiting. Nothing is emailed from
        here — sign-in already proves the address, so there is no link to send and nothing to
        forward or leak.
      </p>

      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-secondary">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            className="w-64 rounded-md border border-outline_variant bg-surface px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-secondary">App</span>
          <select
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            className="rounded-md border border-outline_variant bg-surface px-3 py-2 text-sm"
          >
            {apps.map((a) => (
              <option key={a.id} value={a.id}>{a.display_name}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-secondary">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-md border border-outline_variant bg-surface px-3 py-2 text-sm"
          >
            {/* Viewer and editor first: handing out ownership should take a deliberate scroll
                rather than being the thing under the cursor. */}
            <option value="viewer">viewer — read only</option>
            <option value="editor">editor — author and publish</option>
            <option value="owner">owner — can also invite</option>
          </select>
        </label>

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on_primary disabled:opacity-50"
        >
          {busy ? "Inviting…" : "Invite"}
        </button>
      </form>

      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? "text-tertiary" : "text-error"}`} role="status">
          {msg.text}
        </p>
      )}

      <h3 className="mt-8 font-display text-base font-semibold">Pending invitations</h3>
      {pending.length === 0 ? (
        <p className="mt-2 text-sm text-secondary">No one is waiting to accept.</p>
      ) : (
        <ul className="mt-2 divide-y divide-outline_variant rounded-lg border border-outline_variant bg-surface">
          {pending.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <span>
                <span className="font-medium">{p.email}</span>
                <span className="text-secondary"> · {appName(p.app_id)} · </span>
                <span className="font-mono text-[11px] text-on_surface_variant">{p.role}</span>
              </span>
              <span className="flex items-center gap-4">
                {/* An invitation that never expired would be a standing grant to whoever holds
                    that mailbox, indefinitely. Showing the date makes that visible. */}
                <span className="text-xs text-secondary">
                  expires {new Date(p.expires_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => start(async () => { await revokeInvitation(p.id) })}
                  disabled={busy}
                  className="text-xs font-semibold text-error hover:underline disabled:opacity-50"
                >
                  Revoke
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
