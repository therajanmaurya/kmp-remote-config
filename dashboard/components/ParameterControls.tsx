"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  addOverride, createParameter, deleteParameter, type ParameterType, removeOverride,
} from "@/app/apps/[id]/parameters/actions"

const TYPES: ParameterType[] = ["string", "boolean", "number", "json"]

/** The example a given type expects, so nobody has to guess the format of a default. */
const PLACEHOLDER: Record<ParameterType, string> = {
  string: "light",
  boolean: "true",
  number: "5",
  json: '{"gold":10}',
}

export function NewParameterForm({ appId }: { appId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [key, setKey] = useState("")
  const [type, setType] = useState<ParameterType>("boolean")
  const [def, setDef] = useState("false")
  const [description, setDescription] = useState("")

  if (!open) {
    return (
      <button data-testid="new-parameter" onClick={() => setOpen(true)}
        className="rounded bg-primary px-3 py-1.5 text-sm font-semibold text-on_primary hover:bg-primary/90">
        New parameter
      </button>
    )
  }

  return (
    <form
      data-testid="parameter-form"
      className="mt-4 grid gap-3 rounded border p-4 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true); setErr(null)
        const res = await createParameter(appId, { key, type, default_value: def, description })
        if ("error" in res && res.error) setErr(res.error)
        else { setOpen(false); setKey(""); router.refresh() }
        setBusy(false)
      }}
    >
      <label className="text-sm">
        Key
        <input data-testid="parameter-key" value={key} onChange={(e) => setKey(e.target.value)}
          placeholder="welcome_banner_enabled"
          className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm" />
        <span className="mt-1 block text-xs text-secondary">
          lower_snake_case. This is what your app passes to getBoolean / getString.
        </span>
      </label>

      <label className="text-sm">
        Type
        <select data-testid="parameter-type" value={type}
          onChange={(e) => {
            const next = e.target.value as ParameterType
            setType(next)
            // Reset the default to something valid for the new type rather than leaving a
            // value the CHECK will reject — the type picker changing the default is less
            // surprising than a save that fails for a field the operator did not touch.
            setDef(PLACEHOLDER[next])
          }}
          className="mt-1 w-full rounded border px-3 py-2 text-sm">
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>

      <label className="text-sm">
        Default value
        <input data-testid="parameter-default" value={def} onChange={(e) => setDef(e.target.value)}
          placeholder={PLACEHOLDER[type]}
          className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm" />
        <span className="mt-1 block text-xs text-secondary">
          Served when no condition matches. Your app&apos;s bundled default still applies before the
          first fetch lands.
        </span>
      </label>

      <label className="text-sm">
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="optional" className="mt-1 w-full rounded border px-3 py-2 text-sm" />
      </label>

      {err && <p className="text-sm text-error md:col-span-2" role="alert" data-testid="parameter-error">{err}</p>}

      <div className="flex gap-2 md:col-span-2">
        <button disabled={busy} data-testid="save-parameter"
          className="rounded bg-primary px-4 py-2 text-sm font-semibold text-on_primary disabled:opacity-50">
          {busy ? "Saving…" : "Create parameter"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-secondary hover:underline">
          Cancel
        </button>
      </div>
    </form>
  )
}

export function DeleteParameterButton({ appId, parameterId, keyName }: { appId: string; parameterId: string; keyName: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return <button onClick={() => setConfirming(true)} className="text-xs text-secondary hover:text-error hover:underline">Delete</button>
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="text-on_error_container">Delete {keyName}?</span>
      <button onClick={async () => { await deleteParameter(appId, parameterId); router.refresh() }}
        className="rounded bg-error px-2 py-1 text-white">Delete</button>
      <button onClick={() => setConfirming(false)} className="text-secondary hover:underline">Cancel</button>
    </span>
  )
}

export function OverrideEditor({
  appId, parameterId, type, conditions, overrides,
}: {
  appId: string
  parameterId: string
  type: ParameterType
  conditions: { id: string; name: string }[]
  overrides: { id: string; condition_id: string; value: unknown; priority: number }[]
}) {
  const router = useRouter()
  const [conditionId, setConditionId] = useState(conditions[0]?.id ?? "")
  const [value, setValue] = useState(PLACEHOLDER[type])
  // Suggest the next free priority so the common case never collides. The UNIQUE constraint
  // still decides; this just means an operator rarely meets it.
  const [priority, setPriority] = useState(() => Math.max(0, ...overrides.map((o) => o.priority)) + 1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const nameOf = (id: string) => conditions.find((c) => c.id === id)?.name ?? "(deleted condition)"

  return (
    <div className="mt-4">
      <h2 className="text-sm font-medium text-on_surface_variant">Conditional overrides</h2>
      <p className="mt-1 text-xs text-secondary">
        Checked in priority order, lowest first. The first condition that matches wins; if none
        match, the default above is served.
      </p>

      {overrides.length > 0 && (
        <ol className="mt-3 divide-y rounded border">
          {overrides.map((o) => (
            <li key={o.id} data-testid="override-row" className="flex items-center gap-3 p-3 text-sm">
              <span className="w-8 font-mono text-xs text-secondary">{o.priority}</span>
              <span className="flex-1">
                if <strong>{nameOf(o.condition_id)}</strong> then{" "}
                <code className="rounded bg-surface_variant px-1.5 py-0.5 font-mono text-xs">
                  {JSON.stringify(o.value)}
                </code>
              </span>
              <button
                onClick={async () => { await removeOverride(appId, o.id); router.refresh() }}
                className="text-xs text-secondary hover:text-error hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}

      {conditions.length === 0 ? (
        <p className="mt-3 rounded border border-dashed p-4 text-sm text-secondary">
          No conditions defined yet. Create one on the Conditions page, then attach it here.
        </p>
      ) : (
        <form
          data-testid="override-form"
          className="mt-3 flex flex-wrap items-end gap-3 rounded border p-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true); setErr(null)
            const res = await addOverride(appId, parameterId, type, { condition_id: conditionId, value, priority })
            if ("error" in res && res.error) setErr(res.error)
            else router.refresh()
            setBusy(false)
          }}
        >
          <label className="text-sm">
            Condition
            <select data-testid="override-condition" value={conditionId} onChange={(e) => setConditionId(e.target.value)}
              className="mt-1 block rounded border px-2 py-1.5 text-sm">
              {conditions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            Value
            <input data-testid="override-value" value={value} onChange={(e) => setValue(e.target.value)}
              placeholder={PLACEHOLDER[type]}
              className="mt-1 block rounded border px-2 py-1.5 font-mono text-sm" />
          </label>
          <label className="text-sm">
            Priority
            <input data-testid="override-priority" type="number" value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="mt-1 block w-24 rounded border px-2 py-1.5 text-sm" />
          </label>
          <button disabled={busy} data-testid="save-override"
            className="rounded bg-primary px-3 py-1.5 text-sm font-semibold text-on_primary disabled:opacity-50">
            {busy ? "Adding…" : "Add override"}
          </button>
          {err && <p className="w-full text-sm text-error" role="alert" data-testid="override-error">{err}</p>}
        </form>
      )}
    </div>
  )
}
