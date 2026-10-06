"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { duplicateConfig, toggleEnabled } from "@/app/apps/[id]/configs/actions"

export function EnableSwitch({
  appId, configId, initial,
}: { appId: string; configId: string; initial: boolean }) {
  const [on, setOn] = useState(initial)
  const [busy, setBusy] = useState(false)

  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={on ? "Enabled" : "Disabled"}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        const next = !on
        const res = await toggleEnabled(appId, configId, next)
        // Only reflect the new state if the server accepted it — an optimistic flip that
        // silently reverted would tell the operator their config is live when it is not.
        if (!("error" in res && res.error)) setOn(next)
        setBusy(false)
      }}
      className={`inline-flex h-5 w-9 items-center rounded-full transition ${on ? "bg-green-600" : "bg-neutral-300"} disabled:opacity-60`}
    >
      <span className={`h-4 w-4 rounded-full bg-white transition ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  )
}

export function DuplicateButton({ appId, configId }: { appId: string; configId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        const res = await duplicateConfig(appId, configId)
        setBusy(false)
        if ("id" in res && res.id) router.push(`/apps/${appId}/configs/${res.id}`)
      }}
      className="text-xs text-neutral-600 hover:underline disabled:opacity-60"
    >
      {busy ? "…" : "Duplicate"}
    </button>
  )
}
