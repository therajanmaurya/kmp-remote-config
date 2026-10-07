"use server"

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/require-user"

export type ParameterType = "string" | "boolean" | "number" | "json"

/**
 * Parse a default typed by a human into the JSON the column expects.
 *
 * The CHECK constraint refuses a boolean parameter holding `"true"` the string, so a form that
 * posted raw text would hand operators a raw constraint error for a value that looked right on
 * screen. Parsing here keeps the failure in the form, where it can be explained.
 */
function coerce(type: ParameterType, raw: string): { value: unknown } | { error: string } {
  const v = raw.trim()
  switch (type) {
    case "boolean":
      if (v === "true") return { value: true }
      if (v === "false") return { value: false }
      return { error: `A boolean default must be exactly "true" or "false" — got "${raw}".` }
    case "number": {
      if (v === "" || Number.isNaN(Number(v))) return { error: `"${raw}" is not a number.` }
      return { value: Number(v) }
    }
    case "json":
      try {
        const parsed = JSON.parse(v)
        if (parsed === null || typeof parsed !== "object") {
          return { error: "A json default must be an object or an array." }
        }
        return { value: parsed }
      } catch {
        return { error: "That is not valid JSON." }
      }
    case "string":
      return { value: v }
  }
}

export async function createParameter(
  appId: string,
  input: { key: string; type: ParameterType; default_value: string; description: string },
) {
  const { supabase } = await requireUser()
  const coerced = coerce(input.type, input.default_value)
  if ("error" in coerced) return { error: coerced.error }

  // The key shape is also a CHECK. Saying so in the form beats surfacing
  // `violates check constraint "parameter_key_shape"` to someone naming a feature flag.
  if (!/^[a-z][a-z0-9_]*$/.test(input.key)) {
    return { error: "A key must be lower_snake_case and start with a letter." }
  }

  const { error } = await supabase.from("parameter").insert({
    app_id: appId,
    key: input.key,
    type: input.type,
    default_value: coerced.value,
    description: input.description.trim() || null,
  })
  if (error) {
    if (error.code === "23505") return { error: `A parameter called "${input.key}" already exists.` }
    return { error: error.message }
  }
  revalidatePath(`/apps/${appId}`, "layout")
  return { ok: true }
}

export async function updateParameterDefault(
  appId: string,
  parameterId: string,
  type: ParameterType,
  rawDefault: string,
) {
  const { supabase } = await requireUser()
  const coerced = coerce(type, rawDefault)
  if ("error" in coerced) return { error: coerced.error }
  const { error } = await supabase.from("parameter")
    .update({ default_value: coerced.value, updated_at: new Date().toISOString() })
    .eq("id", parameterId)
  if (error) return { error: error.message }
  revalidatePath(`/apps/${appId}`, "layout")
  return { ok: true }
}

export async function deleteParameter(appId: string, parameterId: string) {
  const { supabase } = await requireUser()
  const { error } = await supabase.from("parameter").delete().eq("id", parameterId)
  if (error) return { error: error.message }
  revalidatePath(`/apps/${appId}`, "layout")
  return { ok: true }
}

/** Attach a condition to a parameter with an explicit override value. */
export async function addOverride(
  appId: string,
  parameterId: string,
  type: ParameterType,
  input: { condition_id: string; value: string; priority: number },
) {
  const { supabase } = await requireUser()
  const coerced = coerce(type, input.value)
  if ("error" in coerced) return { error: coerced.error }

  const { error } = await supabase.from("parameter_value").insert({
    parameter_id: parameterId,
    condition_id: input.condition_id,
    value: coerced.value,
    priority: input.priority,
  })
  if (error) {
    // G-8c. `UNIQUE (parameter_id, priority)` exists so ties cannot decide resolution by row
    // order — but "duplicate key value violates unique constraint
    // parameter_value_priority_unique" tells an operator nothing about what to do next.
    if (error.code === "23505" && error.message.includes("priority")) {
      return { error: `Priority ${input.priority} is already used by another override on this parameter. Each override needs its own priority — lower wins.` }
    }
    if (error.code === "23505") {
      return { error: "That condition is already attached to this parameter." }
    }
    if (error.code === "23514") {
      return { error: `That value does not match the parameter's declared type (${type}).` }
    }
    return { error: error.message }
  }
  revalidatePath(`/apps/${appId}`, "layout")
  return { ok: true }
}

export async function removeOverride(appId: string, overrideId: string) {
  const { supabase } = await requireUser()
  const { error } = await supabase.from("parameter_value").delete().eq("id", overrideId)
  if (error) return { error: error.message }
  revalidatePath(`/apps/${appId}`, "layout")
  return { ok: true }
}

export type Explanation = {
  found: boolean
  value: unknown
  source: "condition" | "default"
  condition_id: string | null
  condition_name: string | null
  priority?: number
}

/**
 * Which rule decides this parameter for a given audience.
 *
 * Delegates to `resolve_parameter_explain`, which reuses the same `condition_matches` the edge
 * function resolves with — so the explanation can never describe a decision different from the
 * one a device would get.
 */
export async function explainParameter(
  parameterId: string,
  audience: { platform: string; app_version: string; screen: string | null },
): Promise<Explanation> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase.rpc("resolve_parameter_explain", {
    p_parameter: parameterId,
    p_audience: audience,
  })
  if (error || !data) {
    return { found: false, value: null, source: "default", condition_id: null, condition_name: null }
  }
  return data as Explanation
}
