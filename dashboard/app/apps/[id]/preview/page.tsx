export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { resolvePreview } from "@/lib/resolve-preview"

/**
 * "What would this device receive right now?" — GOAL.md names this the single most useful
 * operator tool, and it was absent.
 *
 * The audience is read from the query string so a preview is a LINK. An operator reporting
 * "iOS 4.2 users see nothing" can paste a URL that reproduces it exactly, instead of
 * describing which boxes they filled in.
 */
export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: Record<string, string | undefined>
}) {
  const { supabase } = await requireUser()

  const audience = {
    platform: searchParams.platform ?? "android",
    app_version: searchParams.app_version ?? "1.0.0",
    sdk_version: searchParams.sdk_version ?? "5.0.0",
    screen: searchParams.screen?.trim() ? searchParams.screen : null,
    device_id: searchParams.device_id?.trim() ? searchParams.device_id : "preview-device",
  }

  const result = await resolvePreview(supabase, params.id, audience)

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link href={`/apps/${params.id}`} className="text-sm text-secondary hover:underline">← app</Link>
      <h1 className="mt-4 text-xl font-semibold">Device preview</h1>
      <p className="mt-1 text-sm text-secondary">
        Resolved from the published snapshot using the same code the edge function runs, so this
        cannot disagree with what devices actually receive.
      </p>

      <form className="mt-6 grid gap-3 rounded border p-4 md:grid-cols-5" data-testid="preview-form">
        <label className="text-sm">
          Platform
          <select name="platform" defaultValue={audience.platform}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm">
            {["android", "ios", "web", "desktop", "wasm"].map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label className="text-sm">
          App version
          <input name="app_version" defaultValue={audience.app_version}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
        </label>
        <label className="text-sm">
          SDK version
          <input name="sdk_version" defaultValue={audience.sdk_version}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
        </label>
        <label className="text-sm">
          Screen
          <input name="screen" defaultValue={audience.screen ?? ""} placeholder="(none)"
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
        </label>
        <label className="text-sm">
          Device id
          {/* Shown and editable because it decides ROLLOUT membership. An operator asking
              "why doesn't my phone get it?" needs to be able to paste their own id. */}
          <input name="device_id" defaultValue={audience.device_id}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
        </label>
        <div className="md:col-span-5">
          <button className="rounded bg-primary px-4 py-2 text-sm font-semibold text-on_primary" data-testid="preview-run">
            Resolve
          </button>
        </div>
      </form>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-on_surface_variant">
          Configs {result.liveVersion ? `(from v${result.liveVersion})` : ""}
        </h2>
        {result.note && (
          // An empty result with no explanation reads as a broken page. Saying WHY it is empty
          // is the difference between a tool and a dead end.
          <p data-testid="preview-note" className="mt-2 rounded border border-dashed p-4 text-sm text-secondary">
            {result.note}
          </p>
        )}
        {result.configs.length > 0 && (
          <pre data-testid="preview-configs"
            className="mt-2 overflow-x-auto rounded bg-code_background p-4 font-mono text-xs text-code_on_background">
            {JSON.stringify(result.configs, null, 2)}
          </pre>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-on_surface_variant">Parameters</h2>
        {Object.keys(result.parameters).length === 0 ? (
          <p className="mt-2 rounded border border-dashed p-4 text-sm text-secondary">
            No parameters defined for this app.
          </p>
        ) : (
          <pre data-testid="preview-parameters"
            className="mt-2 overflow-x-auto rounded bg-code_background p-4 font-mono text-xs text-code_on_background">
            {JSON.stringify(result.parameters, null, 2)}
          </pre>
        )}
      </section>
    </main>
  )
}
