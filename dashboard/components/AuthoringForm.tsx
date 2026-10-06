"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { defaultsFor, fieldsFor, validate, type JsonSchema } from "@/lib/schema-form"
import { authoringShape } from "@/lib/authoring-shape"
import { SchemaForm } from "@/components/SchemaForm"
import { ConfigPreview } from "@/components/ConfigPreview"
import { createConfig, updateConfig, type ConfigInput } from "@/app/apps/[id]/configs/actions"

export type TemplateRow = {
  id: string
  display_name: string
  description: string | null
  payload_schema: JsonSchema
  allowed_displays: string[]
  renders_ui: boolean
  requires_ack: boolean
  min_sdk_version: string
  is_builtin: boolean
}

const PLATFORMS = ["android", "ios", "desktop", "web", "wasm"] as const

export function AuthoringForm({
  appId,
  templates,
  existing,
}: {
  appId: string
  templates: TemplateRow[]
  existing?: { id: string } & Partial<ConfigInput>
}) {
  const router = useRouter()
  const [templateId, setTemplateId] = useState<string | null>(existing?.template_id ?? null)
  const template = templates.find((t) => t.id === templateId) ?? null

  const [payload, setPayload] = useState<Record<string, unknown>>(existing?.payload ?? {})
  const [display, setDisplay] = useState<string>(existing?.display ?? "")
  const [screens, setScreens] = useState<string>((existing?.screens ?? []).join(", "))
  const [platforms, setPlatforms] = useState<string[]>(existing?.platforms ?? [])
  const [minV, setMinV] = useState(existing?.min_app_version ?? "")
  const [maxV, setMaxV] = useState(existing?.max_app_version ?? "")
  const [startsAt, setStartsAt] = useState(existing?.starts_at?.slice(0, 16) ?? "")
  const [endsAt, setEndsAt] = useState(existing?.ends_at?.slice(0, 16) ?? "")
  const [priority, setPriority] = useState(existing?.priority ?? 0)
  const [maxImp, setMaxImp] = useState(existing?.max_impressions ?? 1)
  const [cooldown, setCooldown] = useState(existing?.cooldown_hours ?? 24)
  const [dismissible, setDismissible] = useState(existing?.is_dismissible ?? true)
  const [enabled, setEnabled] = useState(existing?.is_enabled ?? false)

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const shape = template ? authoringShape(template) : null
  const fields = useMemo(() => (template ? fieldsFor(template.payload_schema) : []), [template])

  // requires_ack ⇒ not dismissible: the trigger rejects the pair, so the control is forced
  // and says why rather than letting the operator discover it on save.
  const forcedNonDismissible = Boolean(template?.requires_ack)
  const effectiveDismissible = forcedNonDismissible ? false : dismissible

  const realDisplays = (template?.allowed_displays ?? []).filter((d) => d !== "none")
  const effectiveDisplay =
    display || (realDisplays.length === 1 ? realDisplays[0] : realDisplays.length === 0 ? "none" : "")

  async function submit() {
    if (!template) return
    const fieldErrors = validate(fields, payload)
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) return
    if (!effectiveDisplay) {
      setFormError("Choose how this should appear.")
      return
    }

    setBusy(true)
    setFormError(null)
    const input: ConfigInput = {
      template_id: template.id,
      payload,
      display: effectiveDisplay,
      screens: screens.split(",").map((s) => s.trim()).filter(Boolean),
      platforms,
      min_app_version: minV || null,
      max_app_version: maxV || null,
      priority,
      is_enabled: enabled,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      max_impressions: shape?.showImpressionControls ? maxImp : 0,
      cooldown_hours: shape?.showImpressionControls ? cooldown : 0,
      is_dismissible: effectiveDismissible,
    }

    // Narrowed rather than cast: updateConfig returns no id (the row already has one) and
    // createConfig does, so a single cast across the union is a lie the compiler caught.
    if (existing) {
      const res = await updateConfig(appId, existing.id, input)
      if ("error" in res && res.error) {
        setFormError(res.error)
        setBusy(false)
        return
      }
      router.push(`/apps/${appId}/configs/${existing.id}`)
      return
    }

    const res = await createConfig(appId, input)
    if ("error" in res && res.error) {
      setFormError(res.error)
      setBusy(false)
      return
    }
    router.push(`/apps/${appId}/configs/${res.id}`)
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-xl font-semibold">{existing ? "Edit config" : "New config"}</h1>

      {/* ── 1. Type ─────────────────────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Type</h2>
        <div data-testid="template-picker" className="mt-3 grid gap-3 sm:grid-cols-3">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTemplateId(t.id)
                setDisplay("")
                setErrors({})
                // Seed the schema's declared defaults so the controls and the payload agree
                // from the first render. Editing an existing config keeps its own values.
                if (!existing) setPayload(defaultsFor(fieldsFor(t.payload_schema)))
              }}
              className={`rounded border p-3 text-left text-sm hover:border-neutral-500 ${
                t.id === templateId ? "border-neutral-900 ring-1 ring-neutral-900" : ""
              }`}
            >
              <span className="font-medium">{t.display_name}</span>
              {!t.is_builtin && (
                <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                  custom
                </span>
              )}
              <span className="mt-1 block text-xs text-neutral-500">{t.description}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Nothing below renders until a type is chosen — §11.3. */}
      {template && shape && (
        <>
          <section className="mt-8 grid gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Content</h2>
              <div className="mt-3">
                <SchemaForm
                  fields={fields}
                  values={payload}
                  errors={errors}
                  onChange={(name, value) => setPayload((p) => ({ ...p, [name]: value }))}
                />
              </div>

              {shape.showDisplayPicker && (
                <div data-testid="display-picker" className="mt-5">
                  <label htmlFor="display" className="block text-sm font-medium">
                    How it appears
                  </label>
                  <select
                    id="display"
                    value={effectiveDisplay}
                    onChange={(e) => setDisplay(e.target.value)}
                    className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  >
                    <option value="">Choose…</option>
                    {realDisplays.map((d) => (
                      <option key={d} value={d}>
                        {d.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {shape.showPreview && (
              <div>
                <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Preview</h2>
                <div className="mt-3">
                  <ConfigPreview display={effectiveDisplay || realDisplays[0] || "dialog"} payload={payload} fields={fields} />
                </div>
              </div>
            )}
          </section>

          {/* ── 3. Targeting + schedule ─────────────────────────────────── */}
          <section data-testid="targeting" className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
              Targeting &amp; schedule
            </h2>

            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="screens" className="block text-sm font-medium">Screens</label>
                <input id="screens" value={screens} onChange={(e) => setScreens(e.target.value)}
                  placeholder="home, settings" className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                {/* §11.3: empty must never be ambiguous. */}
                <p className="mt-1 text-xs">
                  {screens.trim() === "" ? (
                    <span className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-700">All screens</span>
                  ) : (
                    <span className="text-neutral-500">Only the screens listed above.</span>
                  )}
                </p>
              </div>

              <fieldset>
                <legend className="text-sm font-medium">Platforms</legend>
                <div className="mt-2 flex flex-wrap gap-3">
                  {PLATFORMS.map((p) => (
                    <label key={p} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={platforms.includes(p)}
                        onChange={(e) =>
                          setPlatforms((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))
                        } />
                      {p}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {platforms.length === 0 ? "All platforms." : "Only those checked."}
                </p>
              </fieldset>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="minv" className="block text-sm font-medium">Min app version</label>
                  <input id="minv" value={minV} onChange={(e) => setMinV(e.target.value)}
                    placeholder="4.0.0" className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="maxv" className="block text-sm font-medium">Max app version</label>
                  <input id="maxv" value={maxV} onChange={(e) => setMaxV(e.target.value)}
                    placeholder="(none)" className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="starts" className="block text-sm font-medium">Starts</label>
                  <input id="starts" type="datetime-local" value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                    className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="ends" className="block text-sm font-medium">Ends</label>
                  <input id="ends" type="datetime-local" value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                    className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                </div>
              </div>

              <div>
                <label htmlFor="priority" className="block text-sm font-medium">Priority</label>
                <input id="priority" type="number" value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                <p className="mt-1 text-xs text-neutral-500">Higher wins when several match.</p>
              </div>

              {shape.showImpressionControls && (
                <div data-testid="impression-controls" className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="maximp" className="block text-sm font-medium">Max impressions</label>
                    <input id="maximp" type="number" min={0} value={maxImp}
                      onChange={(e) => setMaxImp(Number(e.target.value))}
                      className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label htmlFor="cool" className="block text-sm font-medium">Cooldown (hours)</label>
                    <input id="cool" type="number" min={0} value={cooldown}
                      onChange={(e) => setCooldown(Number(e.target.value))}
                      className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                  </div>
                </div>
              )}

              {shape.showImpressionControls && (
                <div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={effectiveDismissible} disabled={forcedNonDismissible}
                      onChange={(e) => setDismissible(e.target.checked)} />
                    Dismissible
                  </label>
                  {forcedNonDismissible && (
                    <p className="mt-1 text-xs text-neutral-500">
                      This type requires acknowledgement, so it cannot be dismissible — a terms
                      change a user can swipe away has not been accepted.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* is_enabled: one switch, off by default, labelled with what turning it on does. */}
            <div className="mt-6 rounded border bg-neutral-50 p-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                Enabled
              </label>
              <p className="mt-1 text-xs text-neutral-600">
                {enabled
                  ? "When you save, this will start serving to matching devices immediately."
                  : "Off — this will be saved but will not serve to anyone until you enable it."}
              </p>
            </div>

            {formError && (
              <p role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {formError}
              </p>
            )}

            <button type="button" onClick={submit} disabled={busy}
              className="mt-5 rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60">
              {busy ? "Saving…" : existing ? "Save changes" : "Save config"}
            </button>
          </section>
        </>
      )}
    </main>
  )
}
