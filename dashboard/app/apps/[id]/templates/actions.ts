"use server"

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/require-user"
import { buildSchema, type BuilderField } from "@/lib/schema-builder"

/** Custom ids must satisfy migration 009's template_custom_id_shape: ^c_[a-z0-9][a-z0-9_-]*$ */
function customId(): string {
  return "c_" + crypto.randomUUID().replace(/-/g, "")
}

export async function createTemplate(
  appId: string,
  input: {
    display_name: string
    description: string
    allowed_displays: string[]
    renders_ui: boolean
    requires_ack: boolean
    fields: BuilderField[]
  },
) {
  const { supabase } = await requireUser()

  if (!input.display_name.trim()) return { error: "Name is required." }
  if (input.fields.length === 0) return { error: "Add at least one field." }
  if (input.renders_ui && input.allowed_displays.length === 0) {
    return { error: "Choose at least one way this can appear." }
  }

  let payload_schema
  try {
    payload_schema = buildSchema(input.fields)
  } catch (e) {
    return { error: (e as Error).message } // actionable: names the offending field
  }

  const { data, error } = await supabase
    .from("template")
    .insert({
      id: customId(),
      display_name: input.display_name.trim(),
      description: input.description.trim() || null,
      payload_schema,
      // A non-UI template declares {none}; migration 004's template_displays_nonempty
      // CHECK requires a non-empty array either way.
      allowed_displays: input.renders_ui ? input.allowed_displays : ["none"],
      renders_ui: input.renders_ui,
      requires_ack: input.requires_ack,
      is_builtin: false,
      app_id: appId,
      // visibility is omitted ON PURPOSE. It defaults to 'private', the INSERT policy
      // permits nothing else, and template_guard refuses otherwise. Sharing is the separate
      // deliberate act below — that is what makes opt-in structural rather than a UI habit.
    })
    .select("id")
    .single()

  if (error) return { error: "Could not create the template." }
  revalidatePath(`/apps/${appId}/templates`)
  return { ok: true, id: data.id }
}

/**
 * Share — and deliberately do NOT send shared_at / shared_by. template_guard stamps both
 * from now() and auth.uid(); anything sent here is overwritten, and sending it would imply
 * the client is the source of a consent record that must not be forgeable.
 */
export async function shareTemplate(appId: string, templateId: string, authorLabel: string | null) {
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from("template")
    .update({ visibility: "community", author_label: authorLabel?.trim() || null })
    .eq("id", templateId)
    .eq("app_id", appId)
  if (error) return { error: "Could not share the template." }
  revalidatePath(`/apps/${appId}/templates`)
  revalidatePath("/community")
  return { ok: true }
}

export async function unshareTemplate(appId: string, templateId: string) {
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from("template")
    .update({ visibility: "private" })
    .eq("id", templateId)
    .eq("app_id", appId)
  if (error) return { error: "Could not withdraw the template." }
  revalidatePath(`/apps/${appId}/templates`)
  revalidatePath("/community")
  return { ok: true }
}

/**
 * Adoption COPIES. A config pointing directly at another app's template is rejected by
 * config_template_coherence (migration 009), because a direct reference would couple two
 * tenants: the author's delete would break the adopter's live configs.
 */
export async function forkTemplate(sourceId: string, targetAppId: string) {
  const { supabase } = await requireUser()
  const { data, error } = await supabase.rpc("fork_template", {
    p_source: sourceId,
    p_target_app: targetAppId,
  })
  if (error) return { error: "Could not add that template to your app." }
  revalidatePath(`/apps/${targetAppId}/templates`)
  return { ok: true, id: data as string }
}
