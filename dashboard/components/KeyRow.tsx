"use client"

import { useState } from "react"
import { issueKeyPair, revokeKey } from "@/app/apps/[id]/keys/actions"

export function IssueKeyButton({ appId }: { appId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="text-right">
      <button
        data-testid="issue-key"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          const res = await issueKeyPair(appId, null)
          if (res?.error) setError(res.error)
          setBusy(false)
        }}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
      >
        {busy ? "Issuing…" : "Issue key"}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  )
}

export function RevokeKeyButton({ keyId, appId }: { keyId: string; appId: string }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="text-xs text-red-700 hover:underline">
        Revoke
      </button>
    )
  }

  return (
    <span className="whitespace-nowrap text-xs">
      {/* Revocation is immediate and takes effect on the next SDK fetch, so it gets a
          confirm step rather than a bare button next to a key that is serving traffic. */}
      <span className="mr-2 text-neutral-600">Revoke for good?</span>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await revokeKey(keyId, appId)
          setBusy(false)
        }}
        className="font-medium text-red-700 hover:underline disabled:opacity-60"
      >
        {busy ? "…" : "Yes"}
      </button>
      <button onClick={() => setConfirming(false)} className="ml-2 text-neutral-500 hover:underline">
        No
      </button>
    </span>
  )
}
