"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { buildSchema, type BuilderField } from "@/lib/schema-builder"
import { fieldsFor } from "@/lib/schema-form"
import { SchemaForm } from "@/components/SchemaForm"
import { ConfigPreview } from "@/components/ConfigPreview"
import { createTemplate } from "@/app/apps/[id]/templates/actions"

const CONTROLS = ["text", "textarea", "url", "switch", "select", "repeat"] as const
/**
 * Exactly the four the SDK's DisplayType can render (RemoteConfig.kt). `inline` appears in
 * some seeded builtins but DisplayType.from() does not know it and falls back to DIALOG —
 * so offering it here would let an operator build a template whose configs render as a
 * dialog on device with nothing reporting the mismatch.
 */
const DISPLAYS = ["dialog", "bottom_sheet", "banner", "fullscreen"] as const

export function SchemaBuilder({ appId }: { appId: string }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [rendersUi, setRendersUi] = useState(true)
  const [requiresAck, setRequiresAck] = useState(false)
  const [displays, setDisplays] = useState<string[]>(["dialog"])
  const [fields, setFields] = useState<BuilderField[]>([
    { name: "title", label: "Title", control: "text", required: true },
  ])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sample, setSample] = useState<Record<string, unknown>>({})

  // Preview through the SAME renderer the authoring screen uses. That reuse is what
  // guarantees the builder cannot compose something authoring then fails to show.
  const preview = useMemo(() => {
    try {
      return { fields: fieldsFor(buildSchema(fields)), error: null as string | null }
    } catch (e) {
      return { fields: [], error: (e as Error).message }
    }
  }, [fields])

  function patch(i: number, p: Partial<BuilderField>) {
    setFields((cur) => cur.map((f, j) => (j === i ? { ...f, ...p } : f)))
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-xl font-semibold">New template</h1>
      <p className="mt-1 max-w-2xl text-sm text-neutral-500">
        Compose the fields an operator will fill in when they author a config of this type.
        The template is saved <strong>private</strong> to this app; sharing it with the
        community is a separate step.
      </p>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div className="space-y-5">
          <div>
            <label htmlFor="tname" className="block text-sm font-medium">Name</label>
            <input id="tname" value={name} onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2 text-sm" placeholder="Welcome card" />
          </div>
          <div>
            <label htmlFor="tdesc" className="block text-sm font-medium">Description</label>
            <input id="tdesc" value={description} onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              placeholder="Shown once to first-time users" />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rendersUi} onChange={(e) => setRendersUi(e.target.checked)} />
            Renders UI
          </label>
          {!rendersUi && (
            <p className="-mt-3 text-xs text-neutral-500">
              A value-only type, like a feature flag. It gets no display, no preview and no
              impression caps.
            </p>
          )}

          {rendersUi && (
            <fieldset>
              <legend className="text-sm font-medium">Can appear as</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {DISPLAYS.map((d) => (
                  <label key={d} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={displays.includes(d)}
                      onChange={(e) =>
                        setDisplays((cur) => (e.target.checked ? [...cur, d] : cur.filter((x) => x !== d)))
                      } />
                    {d.replace(/_/g, " ")}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} />
            Requires acknowledgement
          </label>
          {requiresAck && (
            <p className="-mt-3 text-xs text-neutral-500">
              Configs of this type cannot be dismissible — something a user can swipe away has
              not been acknowledged.
            </p>
          )}

          <div>
            <h2 className="text-sm font-medium">Fields</h2>
            <div className="mt-2 space-y-3">
              {fields.map((f, i) => (
                <div key={i} className="rounded border p-3">
                  <div className="flex gap-2">
                    <input aria-label="Field name" placeholder="field_name" value={f.name}
                      onChange={(e) => patch(i, { name: e.target.value, label: e.target.value })}
                      className="w-1/2 rounded border px-2 py-1 font-mono text-xs" />
                    <select aria-label="Control" value={f.control}
                      onChange={(e) => patch(i, { control: e.target.value as BuilderField["control"] })}
                      className="rounded border px-2 py-1 text-xs">
                      {CONTROLS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={f.required}
                        onChange={(e) => patch(i, { required: e.target.checked })} />
                      required
                    </label>
                    <button type="button" onClick={() => setFields((c) => c.filter((_, j) => j !== i))}
                      className="ml-auto text-xs text-neutral-500 hover:underline">remove</button>
                  </div>
                  {f.control === "select" && (
                    <input aria-label="Options" placeholder="stable, beta"
                      value={(f.options ?? []).join(", ")}
                      onChange={(e) => patch(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                      className="mt-2 w-full rounded border px-2 py-1 text-xs" />
                  )}
                  {f.control === "repeat" && (
                    <input aria-label="Minimum entries" type="number" min={0}
                      value={f.minItems ?? 0}
                      onChange={(e) => patch(i, { minItems: Number(e.target.value) })}
                      className="mt-2 w-24 rounded border px-2 py-1 text-xs" />
                  )}
                </div>
              ))}
            </div>
            <button type="button"
              onClick={() => setFields((c) => [...c, { name: "", label: "", control: "text", required: false }])}
              className="mt-2 rounded border px-2 py-1 text-xs">Add field</button>
          </div>

          {(error || preview.error) && (
            <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {error ?? preview.error}
            </p>
          )}

          <button type="button" disabled={busy || Boolean(preview.error)}
            onClick={async () => {
              setBusy(true); setError(null)
              const res = await createTemplate(appId, {
                display_name: name, description,
                allowed_displays: displays, renders_ui: rendersUi, requires_ack: requiresAck,
                fields,
              })
              if ("error" in res && res.error) { setError(res.error); setBusy(false); return }
              router.push(`/apps/${appId}/templates`)
            }}
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60">
            {busy ? "Saving…" : "Save template"}
          </button>
        </div>

        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            What authors will see
          </h2>
          <div className="mt-3 rounded border p-4">
            <SchemaForm fields={preview.fields} values={sample} errors={{}}
              onChange={(n, v) => setSample((s) => ({ ...s, [n]: v }))} />
          </div>
          {rendersUi && (
            <div className="mt-4">
              <ConfigPreview display={displays[0] ?? "dialog"} payload={sample} fields={preview.fields} />
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
