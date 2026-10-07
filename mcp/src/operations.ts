import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * The rconfig operations an agent can perform, as plain functions.
 *
 * Separated from the MCP plumbing so they are testable without a transport, and so the tool
 * surface stays a thin declaration of names and schemas. Every function returns data or a
 * `{ error }` — none of them throw, because an MCP tool that throws gives the model a stack
 * trace where it needs a sentence it can act on.
 *
 * ## Authorisation
 *
 * This server runs on an OPERATOR'S MACHINE with a service-role key supplied through the
 * environment, which is the same model `supabase-connect.sh` and `e2e_sdk_contract.sh` already
 * use in this project. The consequence has to be stated plainly rather than discovered:
 * **service_role bypasses RLS entirely**, so the `app_id` scoping in these queries IS the
 * tenant boundary — there is no policy behind it to catch a mistake. Every function that
 * touches app-scoped data filters on `app_id` explicitly for that reason.
 *
 * It is therefore not a multi-tenant service and must never be exposed over a network
 * transport or bundled into anything shipped to a user.
 */

export type Result<T> = T | { error: string }

const fail = (what: string, e: { message?: string } | null): { error: string } => ({
  error: `${what}: ${e?.message ?? "unknown error"}`,
})

// ── reading ──────────────────────────────────────────────────────────────────

export async function listApps(db: SupabaseClient): Promise<Result<unknown[]>> {
  const { data, error } = await db
    .from("app")
    .select("id, slug, display_name, platforms, created_at")
    .order("created_at", { ascending: false })
  if (error) return fail("could not list apps", error)
  return data ?? []
}

export async function listParameters(db: SupabaseClient, appId: string): Promise<Result<unknown[]>> {
  const { data, error } = await db
    .from("parameter")
    .select("id, key, type, default_value, description, parameter_value(count)")
    .eq("app_id", appId)
    .order("key")
  if (error) return fail("could not list parameters", error)
  return data ?? []
}

export async function listConditions(db: SupabaseClient, appId: string): Promise<Result<unknown[]>> {
  const { data, error } = await db
    .from("condition")
    .select("id, name, predicate, priority, parameter_value(count)")
    .eq("app_id", appId)
    .order("priority")
  if (error) return fail("could not list conditions", error)
  return data ?? []
}

export async function listVersions(db: SupabaseClient, appId: string): Promise<Result<unknown[]>> {
  const { data, error } = await db
    .from("config_version")
    .select("version, published_at, published_by, rolled_back_from")
    .eq("app_id", appId)
    .order("version", { ascending: false })
  if (error) return fail("could not list versions", error)
  return data ?? []
}

/**
 * What a device with this audience would receive RIGHT NOW.
 *
 * Reads the published snapshot and resolves parameters through the same SQL routine the edge
 * function calls, so an agent asking "why is this user seeing the default?" gets the server's
 * actual answer rather than a second opinion.
 */
export async function previewForDevice(
  db: SupabaseClient,
  appId: string,
  audience: { platform: string; app_version: string; screen?: string | null },
): Promise<Result<{ live_version: number | null; configs: unknown[]; parameters: unknown }>> {
  const { data: latest, error: vErr } = await db
    .from("config_version")
    .select("version, content")
    .eq("app_id", appId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (vErr) return fail("could not read the published snapshot", vErr)

  const { data: parameters, error: pErr } = await db.rpc("resolve_parameters", {
    p_app: appId,
    p_audience: {
      platform: audience.platform,
      screen: audience.screen ?? null,
      app_version: audience.app_version,
    },
  })
  if (pErr) return fail("could not resolve parameters", pErr)

  return {
    live_version: latest?.version ?? null,
    configs: (latest?.content ?? []) as unknown[],
    parameters: parameters ?? {},
  }
}

/** Which rule decided one parameter, and why — the question an operator actually asks. */
export async function explainParameter(
  db: SupabaseClient,
  parameterId: string,
  audience: { platform: string; app_version: string; screen?: string | null },
): Promise<Result<unknown>> {
  const { data, error } = await db.rpc("resolve_parameter_explain", {
    p_parameter: parameterId,
    p_audience: {
      platform: audience.platform,
      screen: audience.screen ?? null,
      app_version: audience.app_version,
    },
  })
  if (error) return fail("could not explain the parameter", error)
  return data
}

// ── writing ──────────────────────────────────────────────────────────────────

export type OnboardInput = {
  display_name: string
  /** KMP default: one id for every target. */
  bundle_id: string
  platforms: string[]
  cert_digests?: string[]
}

/**
 * Register an app end to end — the row, a live+test key per platform, and the bindings those
 * keys are checked against. Mirrors the dashboard wizard, because an agent and an operator
 * producing differently-shaped apps would be a trap.
 */
export async function onboardApp(
  db: SupabaseClient,
  input: OnboardInput,
  ownerId: string,
): Promise<Result<{ app_id: string; keys: { platform: string; environment: string; key: string }[] }>> {
  const slug = input.display_name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  if (!slug) return { error: "display_name has no letters or digits to build a slug from" }
  if (input.platforms.length === 0) return { error: "at least one platform is required" }

  const { data: app, error: appErr } = await db
    .from("app")
    .insert({ owner_id: ownerId, slug, display_name: input.display_name.trim(), platforms: input.platforms })
    .select("id")
    .single()
  if (appErr || !app) {
    if (appErr?.code === "23505") return { error: `an app with slug "${slug}" already exists for this owner` }
    return fail("could not create the app", appErr)
  }

  await db.from("app_member")
    .upsert({ app_id: app.id, user_id: ownerId, role: "owner" }, { onConflict: "app_id,user_id" })

  const rows: Record<string, unknown>[] = []
  for (const platform of input.platforms) {
    for (const environment of ["live", "test"] as const) {
      const { data: key, error: kErr } = await db.rpc("generate_publishable_key", { p_env: environment })
      if (kErr || !key) return fail("could not generate a publishable key", kErr)
      rows.push({
        app_id: app.id,
        key,
        label: `${platform} ${environment}`,
        environment,
        platform,
        bundle_id: input.bundle_id.trim(),
        // Cert digests bind the ANDROID key only — no other platform has an equivalent check.
        cert_digests: platform === "android" ? (input.cert_digests ?? []) : [],
        // test skips attestation so a debug build can run; live keeps 'preferred', not
        // 'required', because no attestation verifier is deployed yet.
        attestation_policy: environment === "test" ? "off" : "preferred",
      })
    }
  }

  const { error: insErr } = await db.from("app_key").insert(rows)
  if (insErr) return fail("the app was created but its keys were not", insErr)

  return {
    app_id: app.id,
    // Returned from what was MINTED, not from a select-back: the insert's RETURNING depends on
    // the membership row written moments earlier being visible to this request.
    keys: rows.map((r) => ({
      platform: String(r.platform), environment: String(r.environment), key: String(r.key),
    })),
  }
}

export async function createParameter(
  db: SupabaseClient,
  appId: string,
  input: { key: string; type: "string" | "boolean" | "number" | "json"; default_value: unknown; description?: string },
): Promise<Result<{ id: string }>> {
  if (!/^[a-z][a-z0-9_]*$/.test(input.key)) {
    return { error: `"${input.key}" is not a valid key — use lower_snake_case starting with a letter` }
  }
  const { data, error } = await db
    .from("parameter")
    .insert({
      app_id: appId, key: input.key, type: input.type,
      default_value: input.default_value, description: input.description ?? null,
    })
    .select("id").single()
  if (error) {
    if (error.code === "23505") return { error: `a parameter called "${input.key}" already exists` }
    if (error.code === "23514") return { error: `the default value does not match the declared type "${input.type}"` }
    return fail("could not create the parameter", error)
  }
  return { id: data.id }
}

export async function createCondition(
  db: SupabaseClient,
  appId: string,
  input: { name: string; predicate: Record<string, unknown>; priority?: number },
): Promise<Result<{ id: string }>> {
  const { data, error } = await db
    .from("condition")
    .insert({ app_id: appId, name: input.name.trim(), predicate: input.predicate, priority: input.priority ?? 100 })
    .select("id").single()
  if (error) {
    if (error.code === "23505") return { error: `a condition called "${input.name}" already exists` }
    return fail("could not create the condition", error)
  }
  return { id: data.id }
}

export async function addOverride(
  db: SupabaseClient,
  input: { parameter_id: string; condition_id: string; value: unknown; priority: number },
): Promise<Result<{ ok: true }>> {
  const { error } = await db.from("parameter_value").insert({
    parameter_id: input.parameter_id, condition_id: input.condition_id,
    value: input.value, priority: input.priority,
  })
  if (error) {
    // Ties cannot exist: two overrides at the same priority would make "first match wins"
    // depend on row order. Say which number collided, not which constraint fired.
    if (error.code === "23505" && error.message.includes("priority")) {
      return { error: `priority ${input.priority} is already used on this parameter — each override needs its own, lower wins` }
    }
    if (error.code === "23505") return { error: "that condition is already attached to this parameter" }
    if (error.code === "23514") return { error: "the value does not match the parameter's declared type" }
    return fail("could not add the override", error)
  }
  return { ok: true }
}

/** Nothing an agent changes reaches a device until this is called. */
export async function publish(db: SupabaseClient, appId: string): Promise<Result<{ version: number }>> {
  const { data, error } = await db.rpc("publish", { p_app: appId })
  if (error) return fail("could not publish", error)
  return { version: data as number }
}

/** Forward-only: publishes a NEW version carrying the old content; nothing is deleted. */
export async function rollback(db: SupabaseClient, appId: string, version: number): Promise<Result<{ version: number }>> {
  const { data, error } = await db.rpc("rollback_to", { p_app: appId, p_version: version })
  if (error) return fail("could not roll back", error)
  return { version: data as number }
}
