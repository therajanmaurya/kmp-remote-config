/**
 * The minimal client shape this module needs.
 *
 * Narrower than `SupabaseClient` on purpose. Every operation goes through one RPC, so `.rpc` is
 * the whole surface — and typing it this way means the client is pinned to the `api` schema at
 * the call site without threading Supabase's schema generics through twelve signatures. It
 * also keeps the test stub honest: a stub that satisfies this type cannot accidentally offer
 * table access the real path no longer has.
 */
export type ApiClient = {
  /** POST { op, args } to v1-admin with the access token as a bearer credential. */
  call(op: string, args: Record<string, unknown>): Promise<{ data?: unknown; error?: string }>
}

/**
 * The only client this module needs: an HTTPS caller holding an access token and nothing else.
 *
 * No Supabase key of any kind — not service-role, not even anon. `v1-admin` authenticates the
 * bearer token and forwards it to `api.rconfig_api`, which decides everything. That is what
 * finally removes the laptop-holds-a-service-key problem rather than relocating it.
 */
export function createApiClient(functionsUrl: string, token: string): ApiClient {
  return {
    async call(op, args) {
      let res: Response
      try {
        res = await fetch(`${functionsUrl.replace(/\/$/, "")}/v1-admin`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ op, args }),
        })
      } catch (e) {
        // A network failure is NOT a refusal. Saying "not permitted" here would send someone to
        // regenerate a token that was fine.
        return { error: `could not reach the control plane: ${(e as Error).message}` }
      }
      let body: { data?: unknown; error?: string }
      try {
        body = await res.json()
      } catch {
        return { error: `the control plane returned ${res.status} with no JSON body` }
      }
      return body
    },
  }
}

/**
 * Every control-plane operation, as a call through ONE authorized entry point.
 *
 * ── What changed and why ──────────────────────────────────────────────────────────────────
 * These functions used to read and write tables directly using a SERVICE-ROLE key, with the
 * access token's scope enforced in this process by a `gate()` wrapper. Three things were wrong:
 * the machine running this server held a credential that bypasses every RLS policy; a bug in
 * `gate()` — or an operation added without it — meant no enforcement at all; and because
 * identity was memoised per process, a revoked token kept working until the next restart.
 *
 * Now the server holds only the ANON key (public) and the access token. `api.rconfig_api`
 * verifies the token, checks the permission and checks the app scope BEFORE it looks at which
 * operation was asked for, so an operation cannot skip authorization. Revocation takes effect
 * on the very next call.
 *
 * Error messages are authored in SQL now rather than translated here. The guarantee is
 * unchanged and still tested: a caller reads what to change, never a raw constraint name.
 */

export type Result<T> = T | { error: string }

/** The shape `api.rconfig_api` returns: exactly one of `data` or `error`. */
type ApiEnvelope = { data?: unknown; error?: string }

export type OnboardInput = {
  display_name: string
  bundle_id: string
  platforms: string[]
  cert_digests?: string[]
}

export type Audience = {
  platform: string
  app_version: string
  screen?: string | null
  locale?: string | null
  device_id?: string | null
}

/**
 * The single call this module makes.
 *
 * A transport failure is reported as such rather than as a refusal: "could not reach the
 * control plane" sends someone to check the network, where "not permitted" sends them to
 * regenerate a token that was fine.
 */
async function call(
  db: ApiClient,
  _token: string,
  op: string,
  args: Record<string, unknown> = {},
): Promise<Result<never>> {
  // The token is held by the client, not threaded per call — it is a property of the connection,
  // the same way a session is. The parameter stays in each signature so the call sites read as
  // authenticated operations rather than anonymous ones.
  const envelope = await db.call(op, args)
  if (envelope.error) return { error: envelope.error } as Result<never>
  return envelope.data as Result<never>
}

export const listApps = (db: ApiClient, token: string) =>
  call(db, token, "list_apps") as Promise<Result<unknown[]>>

export const listParameters = (db: ApiClient, token: string, appId: string) =>
  call(db, token, "list_parameters", { app_id: appId }) as Promise<Result<unknown[]>>

export const listConditions = (db: ApiClient, token: string, appId: string) =>
  call(db, token, "list_conditions", { app_id: appId }) as Promise<Result<unknown[]>>

export const listVersions = (db: ApiClient, token: string, appId: string) =>
  call(db, token, "list_versions", { app_id: appId }) as Promise<Result<unknown[]>>

export const previewForDevice = (db: ApiClient, token: string, appId: string, audience: Audience) =>
  call(db, token, "preview_for_device", { app_id: appId, audience }) as Promise<Result<unknown>>

export const explainParameter = (db: ApiClient, token: string, parameterId: string, audience: Audience) =>
  call(db, token, "explain_parameter", { parameter_id: parameterId, audience }) as Promise<Result<unknown>>

export const onboardApp = (db: ApiClient, token: string, input: OnboardInput) =>
  call(db, token, "onboard_app", { ...input }) as Promise<
    Result<{ app_id: string; keys: { platform: string; environment: string; key: string }[] }>
  >

export type IssueKeyInput = {
  app_id: string
  /** Omit for a key that serves every platform — the normal case for a KMP app. */
  platform?: string
  environment?: "live" | "test"
  bundle_id?: string
  cert_digests?: string[]
  rotate?: boolean
}

/**
 * Add a platform key to an app that already exists.
 *
 * `onboardApp` mints keys only while CREATING an app and refuses a slug it has seen before, so
 * an app registered for Android and later shipped on iOS had no path to an iOS key — and could
 * not reuse the Android one, because `app_key.platform` is enforced rather than advisory
 * (`_shared/identity.ts` answers a mismatch with 403 `platform_mismatch`).
 *
 * Same envelope as onboarding, so a caller that already renders onboarding's keys renders these.
 */
export const issueKey = (db: ApiClient, token: string, input: IssueKeyInput) =>
  call(db, token, "issue_key", { ...input }) as Promise<
    Result<{ app_id: string; keys: { platform: string; environment: string; key: string }[] }>
  >

export type KeyRow = {
  id: string
  key: string
  label: string | null
  environment: string
  platform: string | null
  bundle_id: string | null
  cert_digests: string[]
  attestation_policy: string
  revoked_at: string | null
  created_at: string
}

export const listKeys = (db: ApiClient, token: string, appId: string) =>
  call(db, token, "list_keys", { app_id: appId }) as Promise<Result<KeyRow[]>>

/**
 * Retire one key. Idempotent — re-revoking reports `already_revoked` rather than failing, so a
 * cleanup that re-runs does not trip on the rows it already handled.
 *
 * Revoking the last active key of an environment is refused unless `force`, because it 403s
 * every client in that environment on its next fetch.
 */
export const revokeKey = (db: ApiClient, token: string, keyId: string, force = false) =>
  call(db, token, "revoke_key", { key_id: keyId, ...(force ? { force: true } : {}) }) as Promise<
    Result<{ id: string; revoked?: boolean; already_revoked?: boolean }>
  >

export type ConfigRow = {
  id: string
  template_id: string
  display: string
  is_enabled: boolean
  priority: number
  screens: string[]
  platforms: string[]
  payload: Record<string, unknown>
}

export const listConfigs = (db: ApiClient, token: string, appId: string) =>
  call(db, token, "list_configs", { app_id: appId }) as Promise<Result<ConfigRow[]>>

/**
 * Instantiate a template for an app.
 *
 * Omit `payload` to adopt the template's `default_payload` — real copy that could ship as
 * written, rather than the empty form every config used to start from. The default is COPIED
 * into the config, so editing the template later never rewrites live content under an app.
 *
 * The created config is always DISABLED. There is deliberately no flag to override that: a
 * config created live is a message shown to real users by a call meant only to author one.
 */
export const createConfig = (
  db: ApiClient, token: string, appId: string,
  c: {
    template_id: string
    display?: string
    payload?: Record<string, unknown>
    screens?: string[]
    platforms?: string[]
    priority?: number
    is_dismissible?: boolean
  },
) => call(db, token, "create_config", { app_id: appId, ...c }) as Promise<
  Result<{ id: string; is_enabled: boolean }>
>

/**
 * Edit one config. An absent key leaves its field alone, so updating copy cannot silently clear
 * targeting the caller never mentioned; an explicit `[]` still clears an array back to "all".
 */
export const updateConfig = (
  db: ApiClient, token: string, configId: string,
  c: {
    payload?: Record<string, unknown>
    display?: string
    is_enabled?: boolean
    priority?: number
    screens?: string[]
    platforms?: string[]
  },
) => call(db, token, "update_config", { config_id: configId, ...c }) as Promise<Result<{ id: string }>>

export const createParameter = (
  db: ApiClient, token: string, appId: string,
  p: { key: string; type: string; default_value: unknown; description?: string },
) => call(db, token, "create_parameter", { app_id: appId, ...p }) as Promise<Result<{ id: string }>>

export const createCondition = (
  db: ApiClient, token: string, appId: string,
  c: { name: string; predicate: unknown; priority?: number },
) => call(db, token, "create_condition", { app_id: appId, ...c }) as Promise<Result<{ id: string }>>

/**
 * Note there is no `app_id` here: this names a PARAMETER, and the funnel resolves the owning
 * app to scope-check it. That absence was a hole until migration 017 — the generic scope check
 * keys on `app_id`, so the one write that changes what a targeted audience receives was
 * skipping it entirely.
 */
export const addOverride = (
  db: ApiClient, token: string,
  o: { parameter_id: string; condition_id: string; value: unknown; priority?: number },
) => call(db, token, "add_override", { ...o }) as Promise<Result<{ ok: boolean }>>

export const publish = (db: ApiClient, token: string, appId: string) =>
  call(db, token, "publish", { app_id: appId }) as Promise<Result<{ version: number }>>

export const rollback = (db: ApiClient, token: string, appId: string, version: number) =>
  call(db, token, "rollback", { app_id: appId, version }) as Promise<Result<{ version: number }>>
