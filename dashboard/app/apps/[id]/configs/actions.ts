"use server"

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/require-user"

export type ConfigInput = {
  template_id: string
  payload: Record<string, unknown>
  display: string
  screens: string[]
  platforms: string[]
  min_app_version: string | null
  max_app_version: string | null
  priority: number
  rollout_percentage: number
  cohort: string | null
  is_enabled: boolean
  starts_at: string | null
  ends_at: string | null
  max_impressions: number
  cooldown_hours: number
  is_dismissible: boolean
}

/**
 * Migration 005's config_template_coherence() trigger enforces display ∈ allowed_displays,
 * payload ⊨ payload_schema, requires_ack ⇒ !is_dismissible, and (since 009) that the
 * template belongs to this app. The form's job is to make those unreachable, not to
 * re-implement them — so a trigger rejection is surfaced as a bug report rather than
 * pretended impossible.
 */
function friendlyError(message: string): string {
  if (/belongs to another app/i.test(message)) {
    return "That template belongs to another app. Add it to this app from the community catalog first."
  }
  if (/coherence|jsonb_matches_schema|allowed_displays|requires acknowledgement/i.test(message)) {
    return (
      "The server rejected this config as inconsistent with its template. " +
      "That is a bug in this editor, not in your input — please report it."
    )
  }
  return "Could not save the config."
}

export async function createConfig(appId: string, input: ConfigInput) {
  const { supabase } = await requireUser()

  const { data, error } = await supabase
    .from("config")
    .insert({ app_id: appId, ...input })
    .select("id")
    .single()

  if (error) return { error: friendlyError(error.message) }

  revalidatePath(`/apps/${appId}/configs`)
  return { ok: true, id: data.id }
}

export async function updateConfig(appId: string, configId: string, input: Partial<ConfigInput>) {
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from("config")
    .update(input)
    .eq("id", configId)
    .eq("app_id", appId)
  if (error) return { error: friendlyError(error.message) }
  revalidatePath(`/apps/${appId}/configs`)
  revalidatePath(`/apps/${appId}/configs/${configId}`)
  return { ok: true }
}

export async function toggleEnabled(appId: string, configId: string, next: boolean) {
  return updateConfig(appId, configId, { is_enabled: next })
}

export async function duplicateConfig(appId: string, configId: string) {
  const { supabase } = await requireUser()

  const { data: src, error: readError } = await supabase
    .from("config")
    .select(
      "template_id, payload, display, screens, platforms, min_app_version, max_app_version, locale, priority, starts_at, ends_at, max_impressions, cooldown_hours, is_dismissible, rollout_percentage, cohort",
    )
    .eq("id", configId)
    .eq("app_id", appId)
    .single()

  if (readError || !src) return { error: "Could not read that config." }

  const { data, error } = await supabase
    .from("config")
    // is_enabled is FORCED off. A duplicate that inherited `true` would start serving the
    // instant it was created, which is the opposite of the off-by-default contract the
    // whole product leans on.
    .insert({ app_id: appId, ...src, is_enabled: false })
    .select("id")
    .single()

  if (error) return { error: friendlyError(error.message) }
  revalidatePath(`/apps/${appId}/configs`)
  return { ok: true, id: data.id }
}
