"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { forkTemplate } from "@/app/apps/[id]/templates/actions"

export function AdoptTemplateButton({
  templateId, apps,
}: { templateId: string; apps: { id: string; display_name: string }[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (apps.length === 0) {
    return <p className="text-xs text-secondary">Create an app first.</p>
  }

  async function adopt(appId: string) {
    setBusy(true)
    setError(null)
    const res = await forkTemplate(templateId, appId)
    if ("error" in res && res.error) {
      setError(res.error)
      setBusy(false)
      return
    }
    router.push(`/apps/${appId}/templates`)
  }

  // One app: no picker to show. More than one: the operator must say which.
  if (apps.length === 1) {
    return (
      <div className="text-right">
        <button disabled={busy} onClick={() => adopt(apps[0].id)}
          className="rounded border px-3 py-1.5 text-xs disabled:opacity-60">
          {busy ? "Adding…" : "Add to my app"}
        </button>
        {error && <p role="alert" className="mt-1 text-xs text-on_error_container">{error}</p>}
      </div>
    )
  }

  return (
    <div className="text-right">
      {!open ? (
        <button onClick={() => setOpen(true)} className="rounded border px-3 py-1.5 text-xs">
          Add to my app
        </button>
      ) : (
        <div className="space-y-1">
          {apps.map((a) => (
            <button key={a.id} disabled={busy} onClick={() => adopt(a.id)}
              className="block w-full rounded border px-2 py-1 text-right text-xs hover:bg-surface_variant disabled:opacity-60">
              {a.display_name}
            </button>
          ))}
          <button onClick={() => setOpen(false)} className="text-xs text-secondary hover:underline">
            cancel
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-on_error_container">{error}</p>}
    </div>
  )
}
