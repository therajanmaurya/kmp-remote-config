"use server"

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/require-user"

export type ConditionInput = {
  name: string
  platforms: string[]
  screens: string[]
  min_app_version: string | null
  max_app_version: string | null
  priority: number
}

/**
 * Only keys the operator actually constrained are written.
 *
 * An empty array and an absent key mean the same thing to `condition_matches` — "no
 * constraint" — but storing `{"platforms":[]}` makes the predicate read as if a platform rule
 * exists, and `describePredicate` would have to guess. Omitting keeps the stored object a
 * truthful description of the rule.
 */
function toPredicate(input: ConditionInput): Record<string, unknown> {
  const p: Record<string, unknown> = {}
  if (input.platforms.length) p.platforms = input.platforms
  if (input.screens.length) p.screens = input.screens
  if (input.min_app_version) p.min_app_version = input.min_app_version
  if (input.max_app_version) p.max_app_version = input.max_app_version
  return p
}

export async function createCondition(appId: string, input: ConditionInput) {
  const { supabase } = await requireUser()
  if (!input.name.trim()) return { error: "A condition needs a name — it is how you will recognise it when attaching it." }

  const { error } = await supabase.from("condition").insert({
    app_id: appId,
    name: input.name.trim(),
    predicate: toPredicate(input),
    priority: input.priority,
  })
  if (error) {
    if (error.code === "23505") return { error: `A condition called "${input.name.trim()}" already exists.` }
    return { error: error.message }
  }
  revalidatePath(`/apps/${appId}`, "layout")
  return { ok: true }
}

export async function updateCondition(appId: string, conditionId: string, input: ConditionInput) {
  const { supabase } = await requireUser()
  const { error } = await supabase.from("condition")
    .update({
      name: input.name.trim(),
      predicate: toPredicate(input),
      priority: input.priority,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conditionId)
  if (error) {
    if (error.code === "23505") return { error: `A condition called "${input.name.trim()}" already exists.` }
    return { error: error.message }
  }
  revalidatePath(`/apps/${appId}`, "layout")
  return { ok: true }
}

/**
 * Deleting a condition CASCADES to every override that references it, which is why the UI
 * shows the usage count and asks for confirmation naming it. The cascade is correct — an
 * override whose condition is gone can never match — but it is not obvious, and an operator
 * deleting "iOS users" should know it is removing values from four parameters.
 */
export async function deleteCondition(appId: string, conditionId: string) {
  const { supabase } = await requireUser()
  const { error } = await supabase.from("condition").delete().eq("id", conditionId)
  if (error) return { error: error.message }
  revalidatePath(`/apps/${appId}`, "layout")
  return { ok: true }
}
