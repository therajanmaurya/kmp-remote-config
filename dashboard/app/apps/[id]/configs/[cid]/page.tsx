import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { AuthoringForm, type TemplateRow } from "@/components/AuthoringForm"
import { ImpressionChart, type DayCount } from "@/components/ImpressionChart"

export default async function ConfigDetailPage({
  params,
}: { params: { id: string; cid: string } }) {
  const { supabase } = await requireUser()

  const { data: config } = await supabase
    .from("config")
    .select("id, template_id, payload, display, screens, platforms, min_app_version, max_app_version, priority, is_enabled, starts_at, ends_at, max_impressions, cooldown_hours, is_dismissible")
    .eq("id", params.cid)
    .eq("app_id", params.id)
    .maybeSingle()

  if (!config) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-neutral-500">No config with that id is available to you.</p>
      </main>
    )
  }

  const { data: templates } = await supabase
    .from("template")
    .select("id, display_name, description, payload_schema, allowed_displays, renders_ui, requires_ack, min_sdk_version, is_builtin")
    .or(`is_builtin.eq.true,app_id.eq.${params.id}`)
    .order("display_name")

  const { data: impressions } = await supabase
    .from("impression")
    .select("created_at")
    .eq("config_id", params.cid)
    .gte("created_at", new Date(Date.now() - 14 * 864e5).toISOString())

  const byDay = new Map<string, number>()
  for (const r of impressions ?? []) {
    const d = String(r.created_at).slice(0, 10)
    byDay.set(d, (byDay.get(d) ?? 0) + 1)
  }
  const chart: DayCount[] = [...byDay.entries()].sort().map(([day, count]) => ({ day: day.slice(5), count }))

  return (
    <>
      <div className="mx-auto max-w-5xl px-6 pt-6">
        <Link href={`/apps/${params.id}/configs`} className="text-sm text-neutral-500 hover:underline">
          ← configs
        </Link>
        <p className="mt-2 text-sm">
          Status:{" "}
          <span className={config.is_enabled ? "font-medium text-green-700" : "font-medium text-neutral-600"}>
            {config.is_enabled ? "enabled" : "disabled"}
          </span>
        </p>
      </div>
      <AuthoringForm
        appId={params.id}
        templates={(templates ?? []) as TemplateRow[]}
        existing={{
          id: config.id,
          template_id: config.template_id,
          payload: config.payload as Record<string, unknown>,
          display: config.display,
          screens: config.screens,
          platforms: config.platforms,
          min_app_version: config.min_app_version,
          max_app_version: config.max_app_version,
          priority: config.priority,
          is_enabled: config.is_enabled,
          starts_at: config.starts_at,
          ends_at: config.ends_at,
          max_impressions: config.max_impressions,
          cooldown_hours: config.cooldown_hours,
          is_dismissible: config.is_dismissible,
        }}
      />
      <div className="mx-auto max-w-5xl px-6 pb-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Impressions — last 14 days
        </h2>
        <div className="mt-3"><ImpressionChart data={chart} /></div>
      </div>
    </>
  )
}
