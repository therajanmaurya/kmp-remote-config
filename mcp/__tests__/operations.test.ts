import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  addOverride, createApiClient, createParameter, listApps, listParameters,
  onboardApp, publish, rollback, type ApiClient,
} from "../src/operations.ts"

/**
 * The operations layer.
 *
 * This server holds NO Supabase key. Its only credential is an access token, presented as a
 * bearer credential to `v1-admin`, which forwards it to `api.rconfig_api` — the single funnel
 * that authenticates, checks the permission and checks the app scope BEFORE it looks at which
 * operation was asked for.
 *
 * So the things worth pinning here are narrow and specific:
 *
 *   1. The token actually reaches the wire, in the Authorization header. Nothing downstream of
 *      this module can notice if it does not — the request simply arrives unauthenticated.
 *   2. Each operation sends its own op name and args, so the funnel can scope-check it.
 *   3. A TRANSPORT failure is distinguishable from a REFUSAL. "could not reach the control
 *      plane" sends someone to check the network; a refusal sends them to fix a permission.
 *
 * The refusals themselves are authored and tested in SQL
 * (`supabase/tests/rconfig_api_test.sql`), which can assert that a refusal actually PREVENTED
 * the write — something a stub here cannot.
 */

const TOKEN = "rcp_" + "a".repeat(40)
const URL_ = "https://example.supabase.co/functions/v1"

/** Captures what the client would put on the wire. */
function stubFetch(reply: { status?: number; body?: unknown; throws?: string }) {
  const seen: { url: string; headers: Record<string, string>; body: { op: string; args: unknown } }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (reply.throws) throw new Error(reply.throws)
    seen.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    })
    return {
      status: reply.status ?? 200,
      json: async () => reply.body ?? { data: {} },
    } as Response
  }) as typeof fetch
  return { seen, restore: () => { globalThis.fetch = original } }
}

test("the access token is sent as a bearer credential on every operation", async () => {
  // Enumerated rather than spot-checked. An operation whose request lacked the header would
  // arrive unauthenticated, and this module is the last place that could notice.
  const cases: [string, (c: ApiClient) => Promise<unknown>][] = [
    ["list_apps", (c) => listApps(c, TOKEN)],
    ["list_parameters", (c) => listParameters(c, TOKEN, "app-1")],
    ["onboard_app", (c) => onboardApp(c, TOKEN, { display_name: "A", bundle_id: "com.a", platforms: ["android"] })],
    ["create_parameter", (c) => createParameter(c, TOKEN, "app-1", { key: "k", type: "boolean", default_value: true })],
    ["add_override", (c) => addOverride(c, TOKEN, { parameter_id: "p", condition_id: "c", value: 1 })],
    ["publish", (c) => publish(c, TOKEN, "app-1")],
    ["rollback", (c) => rollback(c, TOKEN, "app-1", 3)],
  ]
  for (const [op, run] of cases) {
    const f = stubFetch({})
    try {
      await run(createApiClient(URL_, TOKEN))
      assert.equal(f.seen.length, 1, `${op} made ${f.seen.length} requests, expected 1`)
      assert.equal(f.seen[0].headers.Authorization, `Bearer ${TOKEN}`, `${op} did not send the token`)
      assert.equal(f.seen[0].body.op, op, `${op} was sent as ${f.seen[0].body.op}`)
      assert.match(f.seen[0].url, /\/v1-admin$/, `${op} did not target v1-admin`)
    } finally {
      f.restore()
    }
  }
})

test("no Supabase key of any kind is sent", async () => {
  // The point of the whole change: this process holds a token and nothing else. A stray apikey
  // header would mean a key is back in the client's hands.
  const f = stubFetch({})
  try {
    await listApps(createApiClient(URL_, TOKEN), TOKEN)
    const keys = Object.keys(f.seen[0].headers).map((k) => k.toLowerCase())
    assert.ok(!keys.includes("apikey"), "an apikey header was sent")
    assert.deepEqual(keys.sort(), ["authorization", "content-type"])
  } finally {
    f.restore()
  }
})

test("an app-scoped operation names its app so the funnel can scope-check it", async () => {
  const f = stubFetch({})
  try {
    await listParameters(createApiClient(URL_, TOKEN), TOKEN, "app-42")
    assert.equal((f.seen[0].body.args as { app_id: string }).app_id, "app-42")
  } finally {
    f.restore()
  }
})

test("add_override sends no app_id — the funnel resolves it from the parameter", async () => {
  // Deliberate, and the reason migration 017 scope-checks this one via its parameter: the
  // generic check keys on app_id, so the one write that changes what a targeted audience
  // receives would otherwise skip it entirely.
  const f = stubFetch({})
  try {
    await addOverride(createApiClient(URL_, TOKEN), TOKEN, { parameter_id: "p", condition_id: "c", value: 1 })
    assert.ok(!("app_id" in (f.seen[0].body.args as object)))
    assert.equal((f.seen[0].body.args as { parameter_id: string }).parameter_id, "p")
  } finally {
    f.restore()
  }
})

test("a refusal is returned verbatim", async () => {
  // Authored once, in SQL. Re-wording it here would produce a second copy that drifts.
  const f = stubFetch({ status: 403, body: { error: "this access token needs the 'write' permission. It has: read" } })
  try {
    const r = await createParameter(createApiClient(URL_, TOKEN), TOKEN, "app-1",
      { key: "k", type: "boolean", default_value: true })
    assert.deepEqual(r, { error: "this access token needs the 'write' permission. It has: read" })
  } finally {
    f.restore()
  }
})

test("a transport failure is not reported as a refusal", async () => {
  const f = stubFetch({ throws: "getaddrinfo ENOTFOUND" })
  try {
    const r = await listApps(createApiClient(URL_, TOKEN), TOKEN)
    assert.match((r as { error: string }).error, /could not reach the control plane/)
    assert.match((r as { error: string }).error, /ENOTFOUND/)
  } finally {
    f.restore()
  }
})

test("a non-JSON response reports its status rather than throwing", async () => {
  // A 502 from the edge runtime arrives as HTML. Letting that throw would surface as an opaque
  // MCP transport error instead of something a caller can act on.
  const f = stubFetch({ status: 502, body: undefined })
  globalThis.fetch = (async () => ({ status: 502, json: async () => { throw new Error("not json") } })) as typeof fetch
  try {
    const r = await listApps(createApiClient(URL_, TOKEN), TOKEN)
    assert.match((r as { error: string }).error, /502/)
  } finally {
    f.restore()
  }
})

test("a successful call unwraps the envelope's data", async () => {
  const f = stubFetch({ body: { data: [{ id: "app-1", slug: "alpha" }] } })
  try {
    assert.deepEqual(await listApps(createApiClient(URL_, TOKEN), TOKEN), [{ id: "app-1", slug: "alpha" }])
  } finally {
    f.restore()
  }
})

test("onboard_app returns the minted keys", async () => {
  const keys = [{ platform: "android", environment: "live", key: "rck_live_x" }]
  const f = stubFetch({ body: { data: { app_id: "app-9", keys } } })
  try {
    const r = await onboardApp(createApiClient(URL_, TOKEN), TOKEN,
      { display_name: "A", bundle_id: "com.a", platforms: ["android"] })
    assert.deepEqual(r, { app_id: "app-9", keys })
  } finally {
    f.restore()
  }
})
