// THE SAME MODULES THE EDGE FUNCTION USES — imported, not reimplemented.
//
// G-8b is the reason. A preview built as a second evaluator drifts from the server silently,
// and an operator trusting a wrong preview is worse off than one with no preview at all. Both
// files are dependency-free TypeScript in this repo, so the dashboard runs the identical code
// paths rather than code that merely agrees today.
//
// If either file ever grows a Deno-only import this will fail to build, which is the correct
// outcome: it would mean the preview could no longer make this guarantee.
import {
  type ConfigRow,
  matchesAudience,
  sdkCanRender,
  type TemplateRow,
  toWireConfig,
} from "@/../supabase/functions/v1-configs/audience"
import { inRollout } from "@/../supabase/functions/v1-configs/rollout"
import type { SupabaseClient } from "@supabase/supabase-js"

export type PreviewAudience = {
  platform: string
  app_version: string
  sdk_version: string
  screen: string | null
  device_id: string
}

export type PreviewResult = {
  liveVersion: number | null
  configs: unknown[]
  parameters: Record<string, unknown>
  /** Why the set is empty, when it is — an empty preview with no reason reads as a bug. */
  note: string | null
}

/**
 * Answer "what would this device receive right now".
 *
 * Reads the PUBLISHED snapshot, exactly as `/v1/configs` does. Previewing the drafts would
 * answer a question nobody asked and would contradict every device in the field.
 */
export async function resolvePreview(
  supabase: SupabaseClient,
  appId: string,
  audience: PreviewAudience,
): Promise<PreviewResult> {
  const { data: latest } = await supabase
    .from("config_version")
    .select("version, content")
    .eq("app_id", appId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latest) {
    return {
      liveVersion: null,
      configs: [],
      parameters: {},
      note: "This app has never published, so devices receive nothing yet.",
    }
  }

  // Same shape the edge function reads: every config column plus the template contract that
  // publish() froze into the snapshot.
  type SnapshotRow = ConfigRow & {
    template: TemplateRow
    starts_at?: string | null
    ends_at?: string | null
    rollout_percentage?: number
  }
  const snapshot = (latest.content ?? []) as SnapshotRow[]
  const now = Date.now()

  const configs = snapshot
    .filter((r) => r.template != null)
    .filter((r) => withinSchedule(r, now))
    .filter((r) =>
      matchesAudience(r, {
        platform: audience.platform,
        appVersion: audience.app_version,
        sdkVersion: audience.sdk_version,
        screen: audience.screen,
      }))
    .filter((r) => sdkCanRender(r.template, audience.sdk_version))
    .filter((r) => inRollout(r.id, audience.device_id, r.rollout_percentage ?? 100))
    .map((r) => toWireConfig(r, r.template))

  const { data: parameters } = await supabase.rpc("resolve_parameters", {
    p_app: appId,
    p_audience: {
      platform: audience.platform,
      screen: audience.screen,
      app_version: audience.app_version,
    },
  })

  return {
    liveVersion: latest.version,
    configs,
    parameters: (parameters ?? {}) as Record<string, unknown>,
    note: configs.length === 0
      ? "Published, but nothing in v" + latest.version + " matches this audience."
      : null,
  }
}

/** Mirrors the edge function: a null bound means unbounded in that direction. */
function withinSchedule(r: { starts_at?: string | null; ends_at?: string | null }, nowMs: number): boolean {
  if (r.starts_at && Date.parse(r.starts_at) > nowMs) return false
  if (r.ends_at && Date.parse(r.ends_at) < nowMs) return false
  return true
}
