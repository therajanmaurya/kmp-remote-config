#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { addOverride, createCondition, createParameter, explainParameter, listApps, listConditions, listParameters, listVersions, onboardApp, previewForDevice, publish, rollback, } from "./operations.js";
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
const SUPABASE_URL = process.env.RCONFIG_SUPABASE_URL;
const SERVICE_KEY = process.env.RCONFIG_SERVICE_ROLE_KEY;
const OWNER_ID = process.env.RCONFIG_OWNER_ID;
if (!SUPABASE_URL || !SERVICE_KEY) {
    // stderr, not stdout: stdout is the MCP transport, and a human-readable line written there
    // corrupts the protocol stream.
    console.error("rconfig-mcp: RCONFIG_SUPABASE_URL and RCONFIG_SERVICE_ROLE_KEY are required.\n" +
        "Resolve them from the vault, for example:\n" +
        "  RCONFIG_SUPABASE_URL=$(secrets get kmp-remote-config-supabase-url) \\\n" +
        "  RCONFIG_SERVICE_ROLE_KEY=$(secrets get kmp-remote-config-supabase-service-role-key) rconfig-mcp");
    process.exit(2);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
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
    "other tool takes an app_id, and this is the only way to discover one.", {}, async () => reply(await listApps(db)));
server.tool("list_parameters", "List an app's typed parameters, with how many conditional overrides each carries.", { app_id: z.string().uuid() }, async ({ app_id }) => reply(await listParameters(db, app_id)));
server.tool("list_conditions", "List an app's named audience conditions and how many parameters reference each.", { app_id: z.string().uuid() }, async ({ app_id }) => reply(await listConditions(db, app_id)));
server.tool("list_versions", "List an app's published revisions, newest first. Every revision is immutable.", { app_id: z.string().uuid() }, async ({ app_id }) => reply(await listVersions(db, app_id)));
// ── onboarding ───────────────────────────────────────────────────────────────
server.tool("onboard_app", "Register an app end to end: the app, a live and test publishable key per platform, and the " +
    "package and certificate bindings those keys are checked against. Kotlin Multiplatform " +
    "shares ONE application id across every target, which is what bundle_id means here.", {
    display_name: z.string().describe("human name, e.g. 'rconfig Sample'"),
    bundle_id: z.string().describe("reverse-DNS application id shared by every target, e.g. com.mobilebytesensei.rconfig"),
    platforms: z.array(z.string()).describe("android | ios | desktop | web | wasm"),
    cert_digests: z.array(z.string()).optional()
        .describe("SHA-256 signing fingerprints. Android only. Plural: Play re-signs, so the upload key and the app-signing key are different certificates."),
    owner_id: z.string().uuid().optional()
        .describe("auth user to own the app; defaults to RCONFIG_OWNER_ID"),
}, async (input) => {
    const owner = input.owner_id ?? OWNER_ID;
    if (!owner) {
        return reply({ error: "no owner: pass owner_id or set RCONFIG_OWNER_ID. An app must belong to a real auth user or nobody can see it in the dashboard." });
    }
    return reply(await onboardApp(db, input, owner));
});
// ── authoring ────────────────────────────────────────────────────────────────
server.tool("create_parameter", "Create a typed parameter with a default. The default must match the declared type — a " +
    "boolean parameter cannot hold the string \"yes\".", {
    app_id: z.string().uuid(),
    key: z.string().describe("lower_snake_case, e.g. welcome_banner_enabled"),
    type: z.enum(["string", "boolean", "number", "json"]),
    default_value: z.any().describe("served when no condition matches"),
    description: z.string().optional(),
}, async ({ app_id, ...rest }) => reply(await createParameter(db, app_id, rest)));
server.tool("create_condition", "Create a named audience condition. Define it once and attach it to many parameters — a " +
    "parameter stores a REFERENCE, so editing the condition changes every parameter using it.", {
    app_id: z.string().uuid(),
    name: z.string().describe("how you will recognise it, e.g. 'Android beta users'"),
    predicate: z.record(z.string(), z.any())
        .describe('e.g. {"platforms":["android"],"min_app_version":"4.0.0"}; absent keys mean no constraint'),
    priority: z.number().int().optional().describe("default ordering when attaching; defaults to 100"),
}, async ({ app_id, ...rest }) => reply(await createCondition(db, app_id, rest)));
server.tool("add_override", "Attach a condition to a parameter with the value it should serve. Overrides are checked in " +
    "priority order, lowest first, and the FIRST match wins — so a device receives exactly one " +
    "value. Two overrides cannot share a priority.", {
    parameter_id: z.string().uuid(),
    condition_id: z.string().uuid(),
    value: z.any(),
    priority: z.number().int().describe("lower is checked first"),
}, async (input) => reply(await addOverride(db, input)));
// ── inspection ───────────────────────────────────────────────────────────────
server.tool("preview_for_device", "What a device with this audience would receive right now, read from the PUBLISHED snapshot. " +
    "Unpublished edits do not appear here, which is the point.", { app_id: z.string().uuid(), ...audienceShape }, async ({ app_id, ...audience }) => reply(await previewForDevice(db, app_id, audience)));
server.tool("explain_parameter", "Which rule decides one parameter for a given audience, and whether it was a condition or " +
    "the default. Use this to answer 'why is this device getting that value?'.", { parameter_id: z.string().uuid(), ...audienceShape }, async ({ parameter_id, ...audience }) => reply(await explainParameter(db, parameter_id, audience)));
// ── release ──────────────────────────────────────────────────────────────────
server.tool("publish", "Publish the current drafts as a new immutable version. NOTHING an agent changes reaches a " +
    "device until this is called — that separation is deliberate, so a human can review staged " +
    "edits before they ship.", { app_id: z.string().uuid() }, async ({ app_id }) => reply(await publish(db, app_id)));
server.tool("rollback", "Roll back to an earlier version. Forward-only: this publishes a NEW version carrying the old " +
    "content, and the version being undone stays in the history.", { app_id: z.string().uuid(), version: z.number().int().positive() }, async ({ app_id, version }) => reply(await rollback(db, app_id, version)));
await server.connect(new StdioServerTransport());
