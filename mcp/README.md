# rconfig MCP server

Onboard apps and manage parameters, conditions and releases through MCP.

## What this is

An **operator-local** server spoken over stdio, holding a service-role key from the
environment — the same trust model `supabase-connect.sh` and `e2e_sdk_contract.sh` already use
in this repo. It needs no token system the product does not have.

**service_role bypasses RLS.** This process can read and write every app in the project, so the
`app_id` scoping in its queries IS the tenant boundary — there is no policy behind it to catch a
mistake. It is not multi-tenant, must never be exposed over a network transport, and must never
be bundled into anything shipped to a user.

## Running it

```bash
npm --prefix mcp install && npm --prefix mcp run build

RCONFIG_SUPABASE_URL=$(bash core/scripts/secrets-get.sh kmp-remote-config-supabase-url --to-file /dev/stdout) \
RCONFIG_SERVICE_ROLE_KEY=… \
RCONFIG_OWNER_ID=…          \
node mcp/dist/index.js
```

`RCONFIG_OWNER_ID` is the auth user new apps are owned by. An app must belong to a real user or
nobody can see it in the dashboard — `onboard_app` refuses rather than creating an orphan.

Claude Desktop / Claude Code config:

```json
{
  "mcpServers": {
    "rconfig": {
      "command": "node",
      "args": ["/abs/path/to/kmp-remote-config/mcp/dist/index.js"],
      "env": {
        "RCONFIG_SUPABASE_URL": "https://<ref>.supabase.co",
        "RCONFIG_SERVICE_ROLE_KEY": "…",
        "RCONFIG_OWNER_ID": "…"
      }
    }
  }
}
```

## Tools

| Tool | Purpose |
|---|---|
| `list_apps` | Discover app ids — every other tool needs one |
| `list_parameters` / `list_conditions` / `list_versions` | Read an app's current state |
| `onboard_app` | Register an app, its keys, and their package + certificate bindings |
| `create_parameter` / `create_condition` / `add_override` | Author |
| `preview_for_device` | What a given audience receives right now, from the PUBLISHED snapshot |
| `explain_parameter` | Which rule decided one value, and why |
| `publish` / `rollback` | Release |

### Why `publish` is its own tool

Nothing an agent changes reaches a device until `publish` is called. A combined
"set-and-publish" would make the publish gate decorative — the point is that a change is staged,
reviewable and deliberate, so an agent can prepare ten edits and a human can still look before
any device sees them.

### Kotlin Multiplatform

`onboard_app` takes ONE `bundle_id` shared across every target, because a KMP app declares a
single `applicationId` and reuses it. `cert_digests` is Android-only and plural: Play re-signs
your bundle, so the upload key and the app-signing key are different certificates and both must
be accepted. They are SHA-256 — `keytool` prints SHA1 first, and a SHA-1 digest can never match.

## Tests

```bash
npm --prefix mcp test
```

13 tests: nine over the operations layer (every one asserting a raw Postgres constraint name
does NOT survive into a message a model reads), and four driving the built server over real
stdio — handshake, tool listing, descriptions, and that `publish` stayed separate.
