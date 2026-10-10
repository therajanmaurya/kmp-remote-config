#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createApiClient } from "./operations.js";
import { addOverride, createCondition, createParameter, explainParameter, listApps, createConfig, issueKey, listConditions, listConfigs, listKeys, listParameters, listVersions, revokeKey, onboardApp, previewForDevice, updateConfig, publish, rollback, } from "./operations.js";
/**
 * MCP server for the rconfig control plane.
 *
 * ## What this is, and is not
 *
 * An OPERATOR-LOCAL tool, spoken over stdio, holding a service-role key from the environment.
 * That is the same trust model `supabase-connect.sh` already uses in this project, and it
 * avoids inventing a token system the product does not have.
 *
 * The consequence must be stated rather than discovered: **service_role bypasses RLS**, so
 * this process can read and write every app in the project. It is not multi-tenant, must never
 * be exposed over a network transport, and must never be bundled into anything shipped.
 *
 * ## Why the tools are shaped this way
 *
 * `publish` is a SEPARATE tool from every write. An agent that edited and published in one
 * step would make the Phase 02 safety gate decorative — the whole point is that a change is
 * staged, reviewable, and deliberate. An agent can stage ten edits and a human can still look
 * before any device sees them.
 */
const FUNCTIONS_URL = process.env.RCONFIG_FUNCTIONS_URL;
const ACCESS_TOKEN = process.env.RCONFIG_ACCESS_TOKEN;
if (!FUNCTIONS_URL || !ACCESS_TOKEN) {
    // stderr, not stdout: stdout is the MCP transport, and a human-readable line written there
    // corrupts the protocol stream.
    console.error("rconfig-mcp: RCONFIG_FUNCTIONS_URL and RCONFIG_ACCESS_TOKEN are required.\n" +
        "\n" +
        "  This server holds NO Supabase key - not service-role, not anon. Its only credential is\n" +
        "  an rcp_ access token from the dashboard: Account -> Access Tokens. It carries WHO you are,\n" +
        "  WHICH apps may be touched and WHAT may be done, and the control plane checks all three on\n" +
        "  every call - so revoking it takes effect immediately.\n" +
        "\n" +
        "  (The per-app rck_ publishable key is the opposite: PUBLIC, and it belongs in your app's\n" +
        "  source code. It cannot authenticate here.)\n" +
        "\n" +
        "  RCONFIG_FUNCTIONS_URL=https://<ref>.supabase.co/functions/v1 \\\n" +
        "  RCONFIG_ACCESS_TOKEN=$(secrets get mbs-rconfig-access-token) rconfig-mcp\n");
    process.exit(2);
}
const db = createApiClient(FUNCTIONS_URL, ACCESS_TOKEN);
// The token's SHAPE is checked at startup — local, free, and it catches the common mistake
// (pasting a public rck_ publishable key where the secret rcp_ access token belongs) at the
// moment the operator is looking at the terminal.
if (!/^rcp_[A-Za-z0-9]{40}$/.test(ACCESS_TOKEN)) {
    console.error(/^rck_/.test(ACCESS_TOKEN)
        ? "rconfig-mcp: RCONFIG_ACCESS_TOKEN looks like a publishable key (rck_…). That key is PUBLIC " +
            "and belongs in your app's source code; it cannot authenticate the control plane. " +
            "Generate an access token (rcp_…) under Account → Access Tokens."
        : "rconfig-mcp: RCONFIG_ACCESS_TOKEN is not a valid access token. Expected an rcp_ token " +
            "from Account → Access Tokens.");
    process.exit(2);
}
// There is deliberately NO identity resolution or memoisation here any more.
//
// `api.rconfig_api` verifies the token on EVERY call, so revocation takes effect on the very
// next request rather than at the next restart — which is the gap the in-process design had.
// Caching identity here would quietly reintroduce it.
const server = new McpServer({ name: "rconfig", version: "0.1.0" });
/** Tools return data as JSON text — the model reads it; nothing here renders for a human. */
const reply = (payload) => ({
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});
const audienceShape = {
    platform: z.string().describe("android | ios | desktop | web | wasm"),
    app_version: z.string().describe("semver, e.g. 4.3.0"),
    screen: z.string().nullable().optional().describe("screen scope, or null for untargeted"),
};
// ── discovery ────────────────────────────────────────────────────────────────
server.tool("list_apps", "List every app in this control plane, with its slug, platforms and id. Start here: every " +
    "other tool takes an app_id, and this is the only way to discover one.", {}, 
// The funnel already filters to the token's scope — a model told an app exists would
// immediately try to use it and be refused, so the filtering happens at the source.
async () => reply(await listApps(db, ACCESS_TOKEN)));
server.tool("list_parameters", "List an app's typed parameters, with how many conditional overrides each carries.", { app_id: z.string().uuid() }, async ({ app_id }) => reply(await listParameters(db, ACCESS_TOKEN, app_id)));
server.tool("list_conditions", "List an app's named audience conditions and how many parameters reference each.", { app_id: z.string().uuid() }, async ({ app_id }) => reply(await listConditions(db, ACCESS_TOKEN, app_id)));
server.tool("list_versions", "List an app's published revisions, newest first. Every revision is immutable.", { app_id: z.string().uuid() }, async ({ app_id }) => reply(await listVersions(db, ACCESS_TOKEN, app_id)));
// ── onboarding ───────────────────────────────────────────────────────────────
server.tool("onboard_app", "Register an app end to end: the app, a live and test publishable key per platform, and the " +
    "package and certificate bindings those keys are checked against. Kotlin Multiplatform " +
    "shares ONE application id across every target, which is what bundle_id means here.", {
    display_name: z.string().describe("human name, e.g. 'rconfig Sample'"),
    bundle_id: z.string().describe("reverse-DNS application id shared by every target, e.g. com.mobilebytesensei.rconfig"),
    platforms: z.array(z.string()).describe("android | ios | desktop | web | wasm"),
    cert_digests: z.array(z.string()).optional()
        .describe("SHA-256 signing fingerprints. Android only. Plural: Play re-signs, so the upload key and the app-signing key are different certificates."),
    // There is deliberately NO owner_id parameter. Ownership comes from the access token and
    // nowhere else. The previous version accepted one and fell back to an env var, which once
    // identity is token-derived becomes privilege escalation: any caller could mint an app
    // owned by another user and have it appear in that user's dashboard.
}, 
// The scoped-token refusal and ownership both live in the funnel now (migration 017):
// a scoped token cannot register a new app, and the owner is the token's user.
async (input) => reply(await onboardApp(db, ACCESS_TOKEN, input)));
server.tool("issue_key", "Issue a publishable key for an app that ALREADY EXISTS. Omitting `platform` mints a key " +
    "that serves every target of the app, which is what a Kotlin Multiplatform consumer wants: " +
    "one key, set up once in Koin. onboard_app cannot help here — it mints keys only while " +
    "creating an app and refuses a name it has already seen.", {
    app_id: z.string().uuid(),
    platform: z.string().optional()
        .describe("OMIT for a key that serves every platform — the normal case for a Kotlin Multiplatform app. Pin one only for a genuine exception, e.g. a white-label build under its own bundle id."),
    environment: z.enum(["live", "test"]).optional()
        .describe("omit to mint both, which is what onboard_app does per platform"),
    bundle_id: z.string().optional()
        .describe("defaults to the bundle id already on this app's keys; pass one only if this platform ships under a different identifier"),
    cert_digests: z.array(z.string()).optional()
        .describe("SHA-256 signing fingerprints. Android only."),
    rotate: z.boolean().optional()
        .describe("issue a second key alongside an active one. Without this a repeat call is refused and names the existing key, because running the same command twice is likelier than an intended rotation."),
}, async (input) => reply(await issueKey(db, ACCESS_TOKEN, input)));
// ── configs ──────────────────────────────────────────────────────────────────
server.tool("list_configs", "List an app's configs — the template instances that become dialogs, sheets, banners and " +
    "fullscreen takeovers in the SDK. Includes each one's payload, surface and whether it is live.", { app_id: z.string().uuid() }, async ({ app_id }) => reply(await listConfigs(db, ACCESS_TOKEN, app_id)));
server.tool("create_config", "Instantiate a template for an app. Omit `payload` to adopt the template's default — real " +
    "copy that could ship as written, not an empty form. The default is COPIED, so editing the " +
    "template later never rewrites live content. The config is always created DISABLED; enable " +
    "it with update_config once its copy is right.", {
    app_id: z.string().uuid(),
    template_id: z.string().describe("e.g. announcement, update_available, rating_prompt"),
    display: z.string().optional().describe("defaults to the template's first allowed surface"),
    payload: z.record(z.string(), z.unknown()).optional()
        .describe("must satisfy the template's payload_schema; the server rejects one that cannot render"),
    screens: z.array(z.string()).optional().describe("empty = every screen"),
    platforms: z.array(z.string()).optional().describe("empty = every platform"),
    priority: z.number().optional(),
    is_dismissible: z.boolean().optional()
        .describe("defaults to false for templates that require acknowledgement, true otherwise"),
}, async ({ app_id, ...c }) => reply(await createConfig(db, ACCESS_TOKEN, app_id, c)));
server.tool("list_keys", "List an app's publishable keys, including revoked ones. Keys are public — they ship inside " +
    "every client binary — so the key itself is returned; this is how you find an id to revoke.", { app_id: z.string().uuid() }, async ({ app_id }) => reply(await listKeys(db, ACCESS_TOKEN, app_id)));
server.tool("revoke_key", "Retire a publishable key. Idempotent. Refuses to revoke the last active key of an " +
    "environment — that 403s every client in it on the next fetch — unless force is passed; " +
    "issue the replacement first instead.", {
    key_id: z.string().uuid(),
    force: z.boolean().optional()
        .describe("allow revoking the last active key of its environment"),
}, async ({ key_id, force }) => reply(await revokeKey(db, ACCESS_TOKEN, key_id, force ?? false)));
server.tool("update_config", "Edit one config — its copy, its surface, its targeting, or whether it is live. An absent " +
    "field is left alone, so changing copy cannot clear targeting you did not mention; pass an " +
    "explicit [] to clear screens or platforms back to 'everywhere'.", {
    config_id: z.string().uuid(),
    payload: z.record(z.string(), z.unknown()).optional(),
    display: z.string().optional(),
    is_enabled: z.boolean().optional().describe("true makes it live to real users"),
    priority: z.number().optional(),
    screens: z.array(z.string()).optional(),
    platforms: z.array(z.string()).optional(),
}, async ({ config_id, ...c }) => reply(await updateConfig(db, ACCESS_TOKEN, config_id, c)));
// ── authoring ────────────────────────────────────────────────────────────────
server.tool("create_parameter", "Create a typed parameter with a default. The default must match the declared type — a " +
    "boolean parameter cannot hold the string \"yes\".", {
    app_id: z.string().uuid(),
    key: z.string().describe("lower_snake_case, e.g. welcome_banner_enabled"),
    type: z.enum(["string", "boolean", "number", "json"]),
    default_value: z.any().describe("served when no condition matches"),
    description: z.string().optional(),
}, async ({ app_id, ...rest }) => reply(await createParameter(db, ACCESS_TOKEN, app_id, rest)));
server.tool("create_condition", "Create a named audience condition. Define it once and attach it to many parameters — a " +
    "parameter stores a REFERENCE, so editing the condition changes every parameter using it.", {
    app_id: z.string().uuid(),
    name: z.string().describe("how you will recognise it, e.g. 'Android beta users'"),
    predicate: z.record(z.string(), z.any())
        .describe('e.g. {"platforms":["android"],"min_app_version":"4.0.0"}; absent keys mean no constraint'),
    priority: z.number().int().optional().describe("default ordering when attaching; defaults to 100"),
}, async ({ app_id, ...rest }) => reply(await createCondition(db, ACCESS_TOKEN, app_id, rest)));
server.tool("add_override", "Attach a condition to a parameter with the value it should serve. Overrides are checked in " +
    "priority order, lowest first, and the FIRST match wins — so a device receives exactly one " +
    "value. Two overrides cannot share a priority.", {
    parameter_id: z.string().uuid(),
    condition_id: z.string().uuid(),
    value: z.any(),
    priority: z.number().int().describe("lower is checked first"),
}, async (input) => reply(await addOverride(db, ACCESS_TOKEN, input)));
// ── inspection ───────────────────────────────────────────────────────────────
server.tool("preview_for_device", "What a device with this audience would receive right now, read from the PUBLISHED snapshot. " +
    "Unpublished edits do not appear here, which is the point.", { app_id: z.string().uuid(), ...audienceShape }, async ({ app_id, ...audience }) => reply(await previewForDevice(db, ACCESS_TOKEN, app_id, audience)));
server.tool("explain_parameter", "Which rule decides one parameter for a given audience, and whether it was a condition or " +
    "the default. Use this to answer 'why is this device getting that value?'.", { parameter_id: z.string().uuid(), ...audienceShape }, async ({ parameter_id, ...audience }) => reply(await explainParameter(db, ACCESS_TOKEN, parameter_id, audience)));
// ── release ──────────────────────────────────────────────────────────────────
server.tool("publish", "Publish the current drafts as a new immutable version. NOTHING an agent changes reaches a " +
    "device until this is called — that separation is deliberate, so a human can review staged " +
    "edits before they ship.", { app_id: z.string().uuid() }, async ({ app_id }) => reply(await publish(db, ACCESS_TOKEN, app_id)));
server.tool("rollback", "Roll back to an earlier version. Forward-only: this publishes a NEW version carrying the old " +
    "content, and the version being undone stays in the history.", { app_id: z.string().uuid(), version: z.number().int().positive() }, async ({ app_id, version }) => reply(await rollback(db, ACCESS_TOKEN, app_id, version)));
await server.connect(new StdioServerTransport());
