import { createClient } from "jsr:@supabase/supabase-js@2";
import { isIdentityError, resolveIdentity } from "../_shared/identity.ts";
import { checkAttestation } from "../_shared/attestation-gate.ts";
import { corsPreflight, failSoftConfigs, jsonForbidden, jsonOk, jsonRateLimited } from "../_shared/respond.ts";
import { consumeRateLimit, readSubject } from "../_shared/rate-limit.ts";
import { type ConfigRow, matchesAudience, sdkCanRender, type TemplateRow, toWireConfig } from "./audience.ts";
import { resolveParameters } from "./parameters.ts";
import { inRollout } from "./rollout.ts";

// A snapshot entry is `to_jsonb(config) || {template:…}`, so it carries every config column
// plus the template contract frozen at publish time. Schedule bounds travel with it because
// they are evaluated at FETCH time, not publish time — see below.
type Row = ConfigRow & {
  template: TemplateRow;
  starts_at?: string | null;
  ends_at?: string | null;
  rollout_percentage?: number;
  cohort?: string | null;
};

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
      // Bucketing input. Absent for an SDK older than the rollout feature, or a host app that
      // blocked it — such a caller is EXCLUDED from any partial rollout rather than included,
      // because the alternative turns "10%" into "10% plus everyone we cannot identify".
      deviceId: h.get("X-RC-Device"),
    };

    // A missing SDK version fails every template's min_sdk_version check, so ONE absent
    // header silently blacks out the whole product — indistinguishable from "no configs",
    // which is the exact defect §2.1 describes. Integration misconfiguration must be loud,
    // same class as a bad package id.
    if (!ctx.sdkVersion?.trim()) return jsonForbidden("sdk_version_missing");

    const now = Date.now();
    // Serve the latest PUBLISHED snapshot, never the live `config` rows. Reading the drafts is
    // what made every edit live on the next fetch: an operator mid-sentence in the dashboard
    // was already shipping. `config` is now the draft surface and this is the gate.
    //
    // Scoped by the app resolved from the key. service_role bypasses RLS, so this scoping
    // IS the tenant boundary — there is no policy behind it to catch a mistake here.
    const { data, error } = await db
      .from("config_version")
      .select("content")
      .eq("app_id", id.appId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return failSoft("config_query_failed");

    // An app that has never published serves nothing. Fail CLOSED on purpose: the alternative
    // — falling back to the drafts — would reinstate the exact gap this phase closes, and
    // would do it silently on precisely the apps nobody has reviewed yet.
    const snapshot = ((data?.content ?? []) as unknown as Row[]);

    const configs = snapshot
      .filter((r) => r.template != null)
      // Schedule is evaluated HERE rather than frozen into the snapshot, so a config published
      // today with a start of next Tuesday begins serving on Tuesday with no second publish.
      // Everything else about the row is fixed at publish; only the clock moves.
      .filter((r) => withinSchedule(r, now))
      .filter((r) => matchesAudience(r, ctx))
      .filter((r) => inRollout(r.id, ctx.deviceId, r.rollout_percentage ?? 100))
      .filter((r) => sdkCanRender(r.template, ctx.sdkVersion))
      .map((r) => toWireConfig(r, r.template));

    // Parameters resolve against the SAME audience tuple the configs just filtered on, so a
    // response is internally consistent: a caller cannot receive a config targeted at Android
    // beta alongside a parameter value resolved for someone else.
    // Settings ride in the same envelope the transport already fetches, so honouring them
    // costs the client no extra request. Read alongside the parameters rather than before:
    // neither gates the other, and serialising two awaits would add a round trip to every
    // config fetch for no benefit.
    const settingsQuery = db.from("app_settings")
      .select("enabled, fetch_interval_seconds, cache_ttl_seconds, max_retries, backoff_base_seconds")
      .eq("app_id", id.appId)
      .maybeSingle();

    const parameters = await resolveParameters(db, id.appId, {
      platform: ctx.platform,
      screen: ctx.screen,
      app_version: ctx.appVersion,
    });

    // An app with no settings row falls back to the SDK's own defaults rather than to
    // "disabled". A missing row must never read as a kill switch — that would black out an
    // app nobody had touched.
    const { data: settingsRow } = await settingsQuery;
    const settings = settingsRow ?? undefined;

    // CACHING DEPENDS ON WHETHER A ROLLOUT IS IN FLIGHT.
    //
    // Without a partial rollout no device identity participates in the response, so it is
    // shared across every device in the same audience tuple — which is what keeps it
    // effectively free at the edge.
    //
    // The moment any config is partially rolled out, the response becomes device-SPECIFIC.
    // Serving it from a shared cache would hand one device's rollout membership to every
    // other device behind that cache entry, which both breaks the staging and makes the
    // bucketing look random from the outside. So caching is dropped for exactly those
    // responses, and kept for the common case where nothing is staged.
    const partialRollout = snapshot.some((r) => (r.rollout_percentage ?? 100) < 100);

    return jsonOk(
      { schema_version: 1, configs, parameters, ...(settings ? { settings } : {}) },
      partialRollout ? 0 : 60,
    );
  } catch (e) {
    return failSoft("unhandled", e);
  }
});

/** A null bound means "unbounded in that direction", which is the common case. */
function withinSchedule(r: Row, nowMs: number): boolean {
  if (r.starts_at && Date.parse(r.starts_at) > nowMs) return false;
  if (r.ends_at && Date.parse(r.ends_at) < nowMs) return false;
  return true;
}

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
