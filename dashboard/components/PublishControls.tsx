"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { publishApp, rollbackApp } from "@/app/apps/[id]/actions"

export function PublishButton({ appId, count }: { appId: string; count: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        data-testid="publish-button"
        disabled={busy || count < 1}
        onClick={async () => {
          setBusy(true); setErr(null)
          const res = await publishApp(appId)
          // Never clear the staged list on a failed publish: an operator who sees the pill
          // disappear will believe their change shipped.
          if ("error" in res && res.error) setErr(res.error)
          else router.refresh()
          setBusy(false)
        }}
        className="rounded bg-primary px-4 py-2 text-sm font-semibold text-on_primary hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? "Publishing…" : `Publish ${count} ${count === 1 ? "change" : "changes"} to production`}
      </button>
      {err && <p className="text-sm text-error" role="alert">{err}</p>}
    </div>
  )
}

export function RollbackButton({ appId, version }: { appId: string; version: number }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="rounded border px-2 py-1 text-xs hover:border-outline"
      >
        Roll back to this version
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true); setErr(null)
          const res = await rollbackApp(appId, version)
          if ("error" in res && res.error) setErr(res.error)
          else router.refresh()
          setBusy(false); setConfirming(false)
        }}
        className="rounded bg-primary px-2 py-1 text-xs font-semibold text-on_primary disabled:opacity-50"
      >
        Confirm
      </button>
      <button onClick={() => setConfirming(false)} className="text-xs text-secondary hover:underline">
        Cancel
      </button>
      {err && <span className="text-xs text-error" role="alert">{err}</span>}
    </span>
  )
}
