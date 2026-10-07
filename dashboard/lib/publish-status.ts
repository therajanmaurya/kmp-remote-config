import type { SupabaseClient } from "@supabase/supabase-js"

export type StagedChange = {
  id: string
  template_id: string
  label: string
  kind: "new" | "modified" | "removed"
  before: unknown | null
  after: unknown | null
}

export type PublishStatus = {
  liveVersion: number | null
  staged: StagedChange[]
}

/**
 * Compare the current DRAFTS against the latest published snapshot.
 *
 * Diffed by CONTENT, not by `updated_at`. A timestamp comparison would call a config staged
 * after any save, including one that re-saved the same values — and would miss a config
 * DELETED since the last publish, which has no row left to carry a timestamp. The operator
 * needs to know what will actually change on devices, not what was recently touched.
 */
export async function getPublishStatus(
  supabase: SupabaseClient,
  appId: string,
): Promise<PublishStatus> {
  const [{ data: latest }, { data: drafts }] = await Promise.all([
    supabase.from("config_version").select("version, content")
      .eq("app_id", appId).order("version", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("config").select("id, template_id, payload, display, priority, is_enabled")
      .eq("app_id", appId).eq("is_enabled", true).order("priority", { ascending: false }),
  ])

  const published = new Map<string, Record<string, unknown>>()
  for (const row of (latest?.content ?? []) as Record<string, unknown>[]) {
    published.set(String(row.id), row)
  }

  const staged: StagedChange[] = []
  const seen = new Set<string>()

  for (const d of drafts ?? []) {
    seen.add(d.id)
    const was = published.get(d.id)
    // Compare only the fields a device actually receives. Including updated_at or version
    // here would mark every row changed forever, which trains an operator to ignore the pill.
    const after = { template_id: d.template_id, payload: d.payload, display: d.display, priority: d.priority }
    if (!was) {
      staged.push({ id: d.id, template_id: d.template_id, label: d.template_id, kind: "new", before: null, after })
      continue
    }
    const before = { template_id: was.template_id, payload: was.payload, display: was.display, priority: was.priority }
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      staged.push({ id: d.id, template_id: d.template_id, label: d.template_id, kind: "modified", before, after })
    }
  }

  // Published but no longer an enabled draft: disabling or deleting a config is a change
  // devices will see, and it is the one most easily forgotten before a publish.
  for (const [id, row] of published) {
    if (seen.has(id)) continue
    staged.push({
      id,
      template_id: String(row.template_id ?? ""),
      label: String(row.template_id ?? ""),
      kind: "removed",
      before: { template_id: row.template_id, payload: row.payload, display: row.display, priority: row.priority },
      after: null,
    })
  }

  return { liveVersion: latest?.version ?? null, staged }
}
