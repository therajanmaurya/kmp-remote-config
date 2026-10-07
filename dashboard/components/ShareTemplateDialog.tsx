"use client"

import { useState } from "react"
import { shareTemplate, unshareTemplate } from "@/app/apps/[id]/templates/actions"

/**
 * The consent surface.
 *
 * Spec §15 treats sharing as a consent and licensing act, so this says plainly what it
 * does before asking. The author label is NEVER pre-filled from the account email:
 * publishing a template must not publish an email address.
 */
export function ShareControl({
  appId, templateId, shared, sharedAt, authorLabel,
}: {
  appId: string
  templateId: string
  shared: boolean
  sharedAt: string | null
  authorLabel: string | null
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState(authorLabel ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (shared) {
    return (
      <div className="text-right">
        <p className="text-xs text-secondary">
          {sharedAt ? `shared ${new Date(sharedAt).toISOString().slice(0, 10)}` : "shared"}
          {authorLabel ? ` by ${authorLabel}` : ""}
        </p>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await unshareTemplate(appId, templateId)
            setBusy(false)
          }}
          className="text-xs text-on_surface_variant hover:underline disabled:opacity-60"
        >
          {busy ? "…" : "Withdraw"}
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-on_surface_variant hover:underline">
        Share
      </button>
    )
  }

  return (
    <div className="mt-2 rounded border bg-surface_variant p-3 text-left">
      <p className="text-sm font-medium">Share with the community?</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-on_surface_variant">
        <li>
          This template&apos;s structure and copy become <strong>visible to every other
          operator</strong> on rconfig.
        </li>
        <li>They can add a copy to their own app. Your configs and data are not shared.</li>
        <li>
          You can <strong>withdraw</strong> it later — but withdrawal does not retract copies
          people have already taken.
        </li>
      </ul>
      <label htmlFor={`label-${templateId}`} className="mt-3 block text-xs font-medium">
        Credit (optional)
      </label>
      <input
        id={`label-${templateId}`}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="e.g. Acme Design"
        className="mt-1 w-full rounded border px-2 py-1 text-sm"
      />
      <p className="mt-1 text-[11px] text-secondary">
        Shown on the catalog entry. Left blank, the template is listed without attribution.
      </p>
      {error && <p role="alert" className="mt-2 text-xs text-on_error_container">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            const res = await shareTemplate(appId, templateId, label)
            if ("error" in res && res.error) setError(res.error)
            setBusy(false)
          }}
          className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-on_primary disabled:opacity-60"
        >
          {busy ? "Sharing…" : "Share"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded border px-3 py-1.5 text-xs">
          Cancel
        </button>
      </div>
    </div>
  )
}
