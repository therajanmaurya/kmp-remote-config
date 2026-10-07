import { strict as assert } from "node:assert"
import { test } from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

/**
 * Protocol conformance, driven over REAL stdio against the built server.
 *
 * A server that typechecks but does not speak MCP is a server nobody can use, and no unit test
 * of the operations layer would notice. The credentials below are syntactically valid and
 * point nowhere on purpose: the handshake must not require a reachable database, or the only
 * way to check the wiring would be against production.
 */

async function connect() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...process.env,
      RCONFIG_SUPABASE_URL: "https://example.supabase.co",
      RCONFIG_SERVICE_ROLE_KEY: "handshake-only-not-a-real-key",
    },
  })
  const client = new Client({ name: "protocol-test", version: "0" })
  await client.connect(transport)
  return client
}

test("the server completes an MCP handshake and lists its tools", async () => {
  const client = await connect()
  try {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    assert.deepEqual(names, [
      "add_override", "create_condition", "create_parameter", "explain_parameter",
      "list_apps", "list_conditions", "list_parameters", "list_versions",
      "onboard_app", "preview_for_device", "publish", "rollback",
    ])
  } finally {
    await client.close()
  }
})

test("every tool carries a description a model can choose from", async () => {
  const client = await connect()
  try {
    const { tools } = await client.listTools()
    // A bare name is not enough for a model to decide WHEN to call something. Anything under
    // ~40 characters is a label, not an explanation.
    const thin = tools.filter((t) => (t.description ?? "").length < 40).map((t) => t.name)
    assert.deepEqual(thin, [], `these tools need a fuller description: ${thin.join(", ")}`)
  } finally {
    await client.close()
  }
})

test("publish is its own tool, separate from every write", async () => {
  // The Phase 02 safety gate only means something if staging and shipping are distinct calls.
  // A combined "set_and_publish" would let an agent reach devices in one step.
  const client = await connect()
  try {
    const { tools } = await client.listTools()
    assert.ok(tools.some((t) => t.name === "publish"))
    assert.equal(tools.filter((t) => /publish/.test(t.name)).length, 1)
    for (const t of tools) {
      if (t.name === "publish") continue
      assert.doesNotMatch(t.name, /publish/, `${t.name} must not also publish`)
    }
  } finally {
    await client.close()
  }
})

test("onboard_app asks for the KMP-shared application id", async () => {
  const client = await connect()
  try {
    const { tools } = await client.listTools()
    const onboard = tools.find((t) => t.name === "onboard_app")!
    const props = Object.keys((onboard.inputSchema as { properties?: object }).properties ?? {})
    for (const required of ["display_name", "bundle_id", "platforms"]) {
      assert.ok(props.includes(required), `onboard_app is missing ${required}`)
    }
    // The description has to teach the KMP convention, or a model will invent per-platform ids.
    assert.match(onboard.description ?? "", /Kotlin Multiplatform/i)
  } finally {
    await client.close()
  }
})
