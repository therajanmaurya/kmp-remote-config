import type { SupabaseClient } from "@supabase/supabase-js"
import { getPublishStatus } from "@/lib/publish-status"

export type AppRow = {
  id: string
  slug: string
  display_name: string
  platforms: string[]
  parameters: number
  conditions: number
  configs: number
  keys: number
  liveVersion: number | null
  unpublished: number
}

/**
 * Every app in the account, with the counts the matrix compares them on.
 *
 * The staged count comes from `getPublishStatus` — the SAME diff the per-app publish page
 * uses — rather than a second count computed here. Two definitions of "unpublished" would
 * eventually disagree, and the org view saying 3 while the app view says 4 is worse than the
 * org view not showing it at all.
 */
export async function loadFleet(supabase: SupabaseClient): Promise<AppRow[]> {
  // No .eq("owner_id") — app_select already restricts this to apps the caller can reach.
  // Filtering here as well would MASK an RLS regression rather than catch one.
  const { data: apps } = await supabase
    .from("app")
    .select("id, slug, display_name, platforms")
    .order("created_at", { ascending: false })

  if (!apps?.length) return []

  return Promise.all(
    apps.map(async (app) => {
      const [params, conds, configs, keys, latest, status] = await Promise.all([
        supabase.from("parameter").select("id", { count: "exact", head: true }).eq("app_id", app.id),
        supabase.from("condition").select("id", { count: "exact", head: true }).eq("app_id", app.id),
        supabase.from("config").select("id", { count: "exact", head: true }).eq("app_id", app.id).eq("is_enabled", true),
        supabase.from("app_key").select("id", { count: "exact", head: true }).eq("app_id", app.id).is("revoked_at", null),
        supabase.from("config_version").select("version").eq("app_id", app.id)
          .order("version", { ascending: false }).limit(1).maybeSingle(),
        getPublishStatus(supabase, app.id),
      ])

      return {
        id: app.id,
        slug: app.slug,
        display_name: app.display_name,
        platforms: app.platforms ?? [],
        parameters: params.count ?? 0,
        conditions: conds.count ?? 0,
        configs: configs.count ?? 0,
        keys: keys.count ?? 0,
        liveVersion: latest.data?.version ?? null,
        unpublished: status.staged.length,
      }
    }),
  )
}
