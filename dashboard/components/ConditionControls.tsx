"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createCondition, deleteCondition, type ConditionInput } from "@/app/apps/[id]/conditions/actions"

const PLATFORMS = ["android", "ios", "web", "desktop", "wasm"]

export function NewConditionForm({ appId }: { appId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState<ConditionInput>({
    name: "", platforms: [], screens: [], min_app_version: null, max_app_version: null, priority: 100,
  })

  if (!open) {
    return (
      <button data-testid="new-condition" onClick={() => setOpen(true)}
        className="rounded bg-primary px-3 py-1.5 text-sm font-semibold text-on_primary hover:bg-primary/90">
        New condition
      </button>
    )
  }

  return (
    <form
      data-testid="condition-form"
      className="mt-4 grid gap-3 rounded border p-4 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true); setErr(null)
        const res = await createCondition(appId, form)
        if ("error" in res && res.error) setErr(res.error)
        else { setOpen(false); router.refresh() }
        setBusy(false)
      }}
    >
      <label className="text-sm md:col-span-2">
        Name
        <input data-testid="condition-name" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Android beta users"
          className="mt-1 w-full rounded border px-3 py-2 text-sm" />
        <span className="mt-1 block text-xs text-secondary">
          How you will recognise it when attaching it to a parameter.
        </span>
      </label>

      <fieldset className="text-sm">
        <legend>Platforms</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.platforms.includes(p)}
                onChange={(e) => setForm({
                  ...form,
                  platforms: e.target.checked
                    ? [...form.platforms, p]
                    : form.platforms.filter((x) => x !== p),
                })} />
              {p}
            </label>
          ))}
        </div>
        <span className="mt-1 block text-xs text-secondary">None selected means every platform.</span>
      </fieldset>

      <label className="text-sm">
        Priority
        <input type="number" value={form.priority}
          onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
          className="mt-1 w-full rounded border px-3 py-2 text-sm" />
        <span className="mt-1 block text-xs text-secondary">
          Default order when attaching. Each parameter keeps its own order.
        </span>
      </label>

      <label className="text-sm">
        Min app version
        <input value={form.min_app_version ?? ""}
          onChange={(e) => setForm({ ...form, min_app_version: e.target.value || null })}
          placeholder="4.0.0" className="mt-1 w-full rounded border px-3 py-2 text-sm" />
      </label>
      <label className="text-sm">
        Max app version
        <input value={form.max_app_version ?? ""}
          onChange={(e) => setForm({ ...form, max_app_version: e.target.value || null })}
          placeholder="(none)" className="mt-1 w-full rounded border px-3 py-2 text-sm" />
      </label>

      {err && <p className="text-sm text-error md:col-span-2" role="alert" data-testid="condition-error">{err}</p>}

      <div className="flex gap-2 md:col-span-2">
        <button disabled={busy} data-testid="save-condition"
          className="rounded bg-primary px-4 py-2 text-sm font-semibold text-on_primary disabled:opacity-50">
          {busy ? "Saving…" : "Create condition"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-secondary hover:underline">
          Cancel
        </button>
      </div>
    </form>
  )
}

export function DeleteConditionButton({
  appId, conditionId, name, usedBy,
}: { appId: string; conditionId: string; name: string; usedBy: number }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="text-xs text-secondary hover:text-error hover:underline">
        Delete
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      {/* Naming the consequence. Deleting a condition cascades to every override using it,
          which is correct — an override whose condition is gone can never match — but an
          operator deleting "iOS users" should know they are removing values from N parameters. */}
      <span className="text-on_error_container">
        {usedBy > 0
          ? `Delete "${name}" and its override${usedBy === 1 ? "" : "s"} on ${usedBy} parameter${usedBy === 1 ? "" : "s"}?`
          : `Delete "${name}"?`}
      </span>
      <button disabled={busy}
        onClick={async () => { setBusy(true); await deleteCondition(appId, conditionId); router.refresh() }}
        className="rounded bg-error px-2 py-1 text-white disabled:opacity-50">
        Delete
      </button>
      <button onClick={() => setConfirming(false)} className="text-secondary hover:underline">Cancel</button>
    </span>
  )
}
