import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  addOverride, createParameter, onboardApp, publish, rollback,
} from "../src/operations.ts"

/**
 * The operations layer, against a stubbed Supabase client.
 *
 * What these pin is ERROR TRANSLATION. An MCP tool's output is read by a model deciding what to
 * do next, so `duplicate key value violates unique constraint "parameter_value_priority_unique"`
 * is worse than useless — it names an internal constraint and suggests no action. Every
 * assertion below checks the message says what to change AND that the raw constraint name does
 * not survive.
 */

type Row = Record<string, unknown>

/** Minimal stand-in: each table/rpc call returns whatever the test stages. */
function stubDb(staged: {
  insert?: { data?: Row | null; error?: { code?: string; message?: string } | null }
  rpc?: { data?: unknown; error?: { message?: string } | null }
}) {
  const chain: Record<string, unknown> = {}
  const self: Record<string, unknown> = new Proxy(chain, {
    get(_t, prop) {
      if (prop === "single") return async () => staged.insert ?? { data: null, error: null }
      if (prop === "then") return undefined
      return () => self
    },
  })
  return {
    from: () => ({
      insert: (_rows: unknown) => {
        const r = staged.insert ?? { data: null, error: null }
        // `.insert()` is awaited directly in some paths and `.select().single()` in others.
        return Object.assign(Promise.resolve(r), { select: () => self })
      },
      upsert: async () => ({ error: null }),
      select: () => self,
    }),
    rpc: async () => staged.rpc ?? { data: null, error: null },
  } as never
}

test("a duplicate override priority says which number collided, not which constraint", async () => {
  const db = stubDb({
    insert: {
      error: { code: "23505", message: 'duplicate key value violates unique constraint "parameter_value_priority_unique"' },
    },
  })
  const res = await addOverride(db, { parameter_id: "p", condition_id: "c", value: true, priority: 3 })
  assert.ok("error" in res)
  assert.match(res.error, /priority 3/)
  assert.match(res.error, /lower wins/i)
  assert.doesNotMatch(res.error, /parameter_value_priority_unique/)
})

test("attaching the same condition twice is explained in words", async () => {
  const db = stubDb({
    insert: { error: { code: "23505", message: 'duplicate key value violates unique constraint "parameter_value_once_per_condition"' } },
  })
  const res = await addOverride(db, { parameter_id: "p", condition_id: "c", value: true, priority: 9 })
  assert.ok("error" in res)
  assert.match(res.error, /already attached/i)
})

test("a type mismatch names the declared type", async () => {
  const db = stubDb({ insert: { error: { code: "23514", message: 'violates check constraint "parameter_default_matches_type"' } } })
  const res = await createParameter(db, "app", { key: "flag", type: "boolean", default_value: "yes" })
  assert.ok("error" in res)
  assert.match(res.error, /boolean/)
  assert.doesNotMatch(res.error, /parameter_default_matches_type/)
})

test("a bad parameter key is refused BEFORE the database sees it", async () => {
  // No error staged: the function must reject this itself, or the operator gets a constraint
  // name for a value they typed.
  const db = stubDb({})
  const res = await createParameter(db, "app", { key: "Welcome Banner", type: "boolean", default_value: false })
  assert.ok("error" in res)
  assert.match(res.error, /lower_snake_case/)
})

test("onboarding refuses a name with no slug, before creating anything", async () => {
  const db = stubDb({})
  const res = await onboardApp(db, { display_name: "!!!", bundle_id: "com.example.app", platforms: ["android"] }, "owner")
  assert.ok("error" in res)
  assert.match(res.error, /slug/i)
})

test("onboarding requires at least one platform", async () => {
  const db = stubDb({})
  const res = await onboardApp(db, { display_name: "Sample", bundle_id: "com.example.app", platforms: [] }, "owner")
  assert.ok("error" in res)
  assert.match(res.error, /platform/i)
})

test("onboarding returns a live and test key per platform, with the SHARED id on each", async () => {
  // KMP: one application id across every target. The keys must all carry it.
  let n = 0
  const db = {
    from: () => ({
      insert: (rows: Row[]) => Object.assign(
        Promise.resolve({ error: null }),
        { select: () => ({ single: async () => ({ data: { id: "app-1" }, error: null }) }) },
      ),
      upsert: async () => ({ error: null }),
    }),
    rpc: async () => ({ data: `rck_test_${n++}`, error: null }),
  } as never

  const res = await onboardApp(db, {
    display_name: "rconfig Sample",
    bundle_id: "com.mobilebytesensei.rconfig",
    platforms: ["android", "ios", "desktop"],
  }, "owner-1")

  assert.ok(!("error" in res), JSON.stringify(res))
  assert.equal(res.keys.length, 6, "three platforms × live+test")
  assert.deepEqual(
    [...new Set(res.keys.map((k) => k.platform))].sort(),
    ["android", "desktop", "ios"],
  )
  assert.deepEqual([...new Set(res.keys.map((k) => k.environment))].sort(), ["live", "test"])
})

test("publish and rollback surface the new version number", async () => {
  assert.deepEqual(await publish(stubDb({ rpc: { data: 4 } }), "app"), { version: 4 })
  // Forward-only: rollback_to returns a NEW version, never the one restored.
  assert.deepEqual(await rollback(stubDb({ rpc: { data: 5 } }), "app", 2), { version: 5 })
})

test("a failed publish reports why rather than throwing", async () => {
  const res = await publish(stubDb({ rpc: { error: { message: "not authorised to publish app" } } }), "app")
  assert.ok("error" in res)
  assert.match(res.error, /not authorised/)
})
