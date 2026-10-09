"use client"

import { useState } from "react"
import { mintToken, revokeToken } from "@/app/account/tokens/actions"
import { interpretMintResult } from "@/lib/mint-result"

export type TokenRow = {
  id: string
  name: string
  token_prefix: string
  permissions: string[]
  scoped: boolean
  expires_at: string | null
  last_used_at: string | null
  created_at: string
}

export type ScopeApp = { id: string; display_name: string }

const PERMISSIONS = [
  { id: "read", label: "Read", hint: "List apps, parameters, conditions and published revisions." },
  { id: "write", label: "Write", hint: "Create and edit parameters, conditions and overrides. Changes stay staged." },
  { id: "publish", label: "Publish", hint: "Ship staged changes to devices, and roll back. Separate from Write on purpose." },
] as const

const EXPIRY: { days: number | null; label: string; recommended?: boolean }[] = [
  { days: 7, label: "7 days", recommended: true },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  // Allowed, but not recommended and deliberately last: a token that never expires is one
  // nobody is ever forced to re-justify.
  { days: null, label: "No expiry" },
]

function when(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000)
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days} days ago`
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
}

function expiry(iso: string | null) {
  if (!iso) return { text: "never", expired: false }
  const d = new Date(iso)
  return {
    text: d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }),
    expired: d.getTime() < Date.now(),
  }
}

export function AccessTokens({ tokens, apps }: { tokens: TokenRow[]; apps: ScopeApp[] }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [days, setDays] = useState<number | null>(7)
  const [perms, setPerms] = useState<string[]>(["read"])
  const [scopeAll, setScopeAll] = useState(true)
  const [scopeApps, setScopeApps] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minted, setMinted] = useState<{ token: string; name: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  async function submit() {
    setBusy(true); setError(null)
    // try/catch + interpret, because the previous version did `if (!r.ok)` on whatever came
    // back. When the action's reply was lost, `r` was undefined, that threw inside an async
    // handler, and the screen simply did not change — no token, no error, nothing to act on.
    // Whatever goes wrong now, the operator reads a sentence about it.
    let outcome
    try {
      outcome = interpretMintResult(await mintToken({
        name,
        expiresInDays: days,
        appIds: scopeAll ? null : scopeApps,
        permissions: perms,
      }))
    } catch (e) {
      outcome = { kind: "error" as const, message: `The request failed: ${(e as Error).message}` }
    } finally {
      setBusy(false)
    }
    if (outcome.kind === "error") { setError(outcome.message); return }
    setMinted({ token: outcome.token, name: outcome.name })
    setOpen(false)
    setName(""); setPerms(["read"]); setDays(7); setScopeAll(true); setScopeApps([])
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Access Tokens</h1>
      <p className="mt-1 text-sm text-secondary">
        Create and manage access tokens for API and MCP authentication.
      </p>

      {/* The distinction this whole page turns on. Stated once, at the top, because confusing
          the two key types in either direction is a real failure: treating the publishable key
          as secret adds friction that buys nothing, and treating this token as public hands
          over the account. */}
      <div className="mt-5 flex gap-3 rounded-lg border border-outline_variant bg-surface p-4 text-sm">
        <span className="material-symbols-outlined text-[20px] text-primary" aria-hidden>info</span>
        <div className="space-y-1.5 text-on_surface_variant">
          <p>
            <strong className="font-semibold text-on_surface">An access token is a secret.</strong>{" "}
            It acts as you across every app it can reach — registering apps, minting keys, editing
            parameters and publishing. Keep it in a vault, never in source control.
          </p>
          <p>
            That is the opposite of an app&rsquo;s{" "}
            <strong className="font-semibold text-on_surface">publishable key</strong> (
            <code className="rounded bg-surface_variant px-1 font-mono text-[11px]">rck_…</code>),
            which is public by design, ships inside your app binary and belongs in your source
            code. Publishable keys live on each app&rsquo;s Keys page.
          </p>
        </div>
      </div>

      {minted && (
        <div data-testid="minted-token" className="mt-5 rounded-lg border border-tertiary bg-tertiary_container p-4">
          <p className="text-sm font-semibold text-on_tertiary_container">
            Copy {minted.name} now — this is the only time it is shown.
          </p>
          <p className="mt-1 text-xs text-on_tertiary_container/80">
            Only a hash is stored, so it cannot be displayed again. If you lose it, revoke it and
            create another.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded border border-outline_variant bg-surface px-3 py-2 font-mono text-xs">
              {minted.token}
            </code>
            <button
              onClick={() => { navigator.clipboard.writeText(minted.token); setCopied(true) }}
              className="flex-shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-on_primary"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => { setMinted(null); setCopied(false) }}
              className="flex-shrink-0 rounded-md border border-outline_variant px-3 py-2 text-sm font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-4">
        <h2 className="font-headline text-sm font-semibold">Your tokens</h2>
        <button
          data-testid="generate-token"
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-on_primary"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden>add</span>
          Generate new token
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-5 rounded-lg border border-outline_variant bg-surface p-5">
          <label className="block text-sm font-medium">
            Name
            <input
              data-testid="token-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. CI deploy token"
              className="mt-1 w-full rounded-md border border-outline_variant bg-surface px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs font-normal text-secondary">
              How you will recognise it in this list a year from now.
            </span>
          </label>

          <div>
            <p className="text-sm font-medium">Expires in</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {EXPIRY.map((e) => (
                <button
                  key={e.label}
                  onClick={() => setDays(e.days)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    days === e.days
                      ? "border-primary bg-primary_container font-semibold text-on_primary_container"
                      : "border-outline_variant text-on_surface_variant"
                  }`}
                >
                  {e.label}
                  {e.recommended && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-tertiary">rec</span>}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium">Permissions</p>
            <p className="text-xs text-secondary">Grant the minimum this integration needs.</p>
            <div className="mt-2 space-y-2">
              {PERMISSIONS.map((p) => (
                <label key={p.id} className="flex cursor-pointer gap-2.5 rounded-md border border-outline_variant p-2.5">
                  <input
                    type="checkbox"
                    data-testid={`perm-${p.id}`}
                    checked={perms.includes(p.id)}
                    onChange={() => toggle(perms, setPerms, p.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{p.label}</span>
                    <span className="block text-xs text-secondary">{p.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium">Resource access</p>
            <div className="mt-2 space-y-2">
              <label className="flex cursor-pointer gap-2.5 rounded-md border border-outline_variant p-2.5">
                <input type="radio" checked={scopeAll} onChange={() => setScopeAll(true)} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">All apps</span>
                  <span className="block text-xs text-secondary">
                    Every app you can reach, including ones added later. Required to register a new app.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-2.5 rounded-md border border-outline_variant p-2.5">
                <input type="radio" checked={!scopeAll} onChange={() => setScopeAll(false)} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">Selected apps</span>
                  <span className="block text-xs text-secondary">
                    An exhaustive list. A scoped token cannot register new apps.
                  </span>
                </span>
              </label>
              {!scopeAll && (
                <div className="ml-6 space-y-1.5">
                  {apps.length === 0 && <p className="text-xs text-secondary">No apps to scope to yet.</p>}
                  {apps.map((a) => (
                    <label key={a.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={scopeApps.includes(a.id)}
                        onChange={() => toggle(scopeApps, setScopeApps, a.id)}
                      />
                      {a.display_name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-sm font-medium text-error">{error}</p>}

          <div className="flex gap-2">
            <button
              data-testid="token-submit"
              disabled={busy || !name.trim() || perms.length === 0 || (!scopeAll && scopeApps.length === 0)}
              onClick={submit}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on_primary disabled:opacity-50"
            >
              {busy ? "Generating…" : "Generate token"}
            </button>
            <button onClick={() => setOpen(false)} className="rounded-md border border-outline_variant px-4 py-2 text-sm font-medium">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-outline_variant bg-surface">
        {tokens.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-secondary">
            No access tokens yet. Generate one to use the API or the rconfig MCP server.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-outline_variant bg-surface_variant/50 text-[11px] uppercase tracking-wide text-secondary">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Token</th>
                <th className="px-5 py-2.5 font-semibold">Scope</th>
                <th className="px-5 py-2.5 font-semibold">Last used</th>
                <th className="px-5 py-2.5 font-semibold">Expires</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-outline_variant">
              {tokens.map((t) => {
                const e = expiry(t.expires_at)
                return (
                  <tr key={t.id} data-testid="token-row">
                    <td className="px-5 py-3">
                      <span className="block font-medium">{t.name}</span>
                      {/* A genuine prefix plus a mask: enough to tell two tokens apart, never
                          enough to reconstruct one. */}
                      <span className="block font-mono text-[11px] text-secondary">
                        {t.token_prefix}
                        {"•".repeat(12)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="flex flex-wrap gap-1">
                        {t.permissions.map((p) => (
                          <span key={p} className="rounded bg-surface_variant px-1.5 py-0.5 font-mono text-[10px]">{p}</span>
                        ))}
                        {t.scoped && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">scoped</span>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-on_surface_variant">
                      {when(t.last_used_at) ?? <span className="text-secondary">never</span>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={e.expired ? "font-medium text-error" : "text-on_surface_variant"}>
                        {e.text}{e.expired && " (expired)"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        data-testid="revoke-token"
                        onClick={async () => {
                          if (!confirm(`Revoke "${t.name}"? Anything using it stops working immediately.`)) return
                          await revokeToken(t.id)
                          location.reload()
                        }}
                        className="rounded-md border border-outline_variant px-2.5 py-1 text-xs font-medium text-error"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
