import { createClient } from "jsr:@supabase/supabase-js@2";
import { isIdentityError, resolveIdentity } from "../_shared/identity.ts";
import { checkAttestation } from "../_shared/attestation-gate.ts";
import { corsPreflight, failSoftConfigs, jsonForbidden, jsonOk, jsonRateLimited } from "../_shared/respond.ts";
import { consumeRateLimit, readSubject } from "../_shared/rate-limit.ts";
import { type ConfigRow, matchesAudience, sdkCanRender, type TemplateRow, toWireConfig } from "./audience.ts";

type Row = ConfigRow & { template: TemplateRow };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  // Even a wrong method fails soft: a client bug must not surface as an error screen.
  if (req.method !== "GET") return failSoftConfigs();

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    // A missing binding is an operator mistake, not something the app should break over.
    if (!url || !svc) return failSoft("env_binding_missing");

    const db = createClient(url, svc, { auth: { persistSession: false } });

    const id = await resolveIdentity(db, req.headers);
    if (isIdentityError(id)) return jsonForbidden(id.code);

    // VERIFIES, not merely detects. This route previously accepted any non-empty
    // X-RC-Attestation, so a key set to `required` had a control that reported working and
    // did not: a garbage string returned 200 with the full payload. Same class as the
    // write-path hole, in the sibling route.
    const gate = await checkAttestation(
      id.attestationPolicy,
      req.headers.get("X-RC-Attestation"),
      id.appId,
      id.keyId,
      Deno.env.get("RC_ASSERTION_SECRET"),
    );
    if (gate) return jsonForbidden(gate);

    // O2: 60 req/min/key for reads, read from app_key.rate_limit_per_min so one noisy
    // integration can be tuned without a deploy.
    //
    // Placed AFTER identity because the subject is the resolved key id — there is no
    // per-key bucket for a request whose key is invalid. Those already cost only the key
    // lookup and 403 before reaching here. A caller hammering with a GARBAGE key is
    // therefore not limited by this; that needs an IP-keyed limit, which O2 does not
    // specify and this does not pretend to provide.
    //
    // A cache HIT never reaches this code, which is the intent: the limiter only charges
    // requests that were going to query the database anyway.
    const rate = await consumeRateLimit(db, readSubject(id.keyId), id.rateLimitPerMin);
    if (!rate.allowed) return jsonRateLimited(rate);

    const h = req.headers;
    const ctx = {
      platform: h.get("X-RC-Platform"),
      appVersion: h.get("X-RC-App-Version"),
      sdkVersion: h.get("X-RC-SDK-Version"),
      screen: new URL(req.url).searchParams.get("screen"),
    };

    // A missing SDK version fails every template's min_sdk_version check, so ONE absent
    // header silently blacks out the whole product — indistinguishable from "no configs",
    // which is the exact defect §2.1 describes. Integration misconfiguration must be loud,
    // same class as a bad package id.
    if (!ctx.sdkVersion?.trim()) return jsonForbidden("sdk_version_missing");

    const nowIso = new Date().toISOString();
    // Scoped by the app resolved from the key. service_role bypasses RLS, so this scoping
    // IS the tenant boundary — there is no policy behind it to catch a mistake here.
    const { data, error } = await db
      .from("config")
      .select(
        "id, template_id, payload, display, screens, platforms, min_app_version, max_app_version, priority, is_dismissible, max_impressions, cooldown_hours, version, template:template_id (id, version, renders_ui, requires_ack, min_sdk_version)",
      )
      .eq("app_id", id.appId)
      .eq("is_enabled", true)
      .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
      .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
      .order("priority", { ascending: false });

    if (error) return failSoft("config_query_failed");

    const configs = ((data ?? []) as unknown as Row[])
      .filter((r) => r.template != null)
      .filter((r) => matchesAudience(r, ctx))
      .filter((r) => sdkCanRender(r.template, ctx.sdkVersion))
      .map((r) => toWireConfig(r, r.template));

    // No device identity participates in this response, so it is shared across every device
    // in the same audience tuple — which is what keeps it effectively free at the edge.
    return jsonOk({ schema_version: 1, configs }, 60);
  } catch (e) {
    return failSoft("unhandled", e);
  }
});

/**
 * Fail soft, but never silently. §8.1 requires the failure be reported, "because a fetch
 * failure and an empty set are otherwise indistinguishable — the exact gap §2.1 describes".
 * Without this emit the server reproduces the very defect the product exists to remove.
 *
 * Operation SHAPE only: a stage code and an error class. Never config ids, payloads, or
 * device_id.
 */
function failSoft(stage: string, e?: unknown): Response {
  console.error(JSON.stringify({
    route: "v1-configs",
    stage,
    error: e instanceof Error ? e.name : undefined,
  }));
  return failSoftConfigs();
}
