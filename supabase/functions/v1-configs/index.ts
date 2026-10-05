import { createClient } from "jsr:@supabase/supabase-js@2";
import { isIdentityError, resolveIdentity } from "../_shared/identity.ts";
import { corsPreflight, failSoftConfigs, jsonForbidden, jsonOk } from "../_shared/respond.ts";
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
    if (!url || !svc) return failSoftConfigs();

    const db = createClient(url, svc, { auth: { persistSession: false } });

    const id = await resolveIdentity(db, req.headers);
    if (isIdentityError(id)) return jsonForbidden(id.code);

    // Reads are policy-driven: `required` demands an assertion here, `preferred`/`off` do
    // not. Requiring it on every read would make the response per-device and destroy the
    // edge cache, to protect content that is rendered to users anyway.
    if (id.attestationPolicy === "required" && !req.headers.get("X-RC-Attestation")) {
      return jsonForbidden("attestation_required");
    }

    const h = req.headers;
    const ctx = {
      platform: h.get("X-RC-Platform"),
      appVersion: h.get("X-RC-App-Version"),
      sdkVersion: h.get("X-RC-SDK-Version"),
      screen: new URL(req.url).searchParams.get("screen"),
    };

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

    if (error) return failSoftConfigs();

    const configs = ((data ?? []) as unknown as Row[])
      .filter((r) => r.template != null)
      .filter((r) => matchesAudience(r, ctx))
      .filter((r) => sdkCanRender(r.template, ctx.sdkVersion))
      .map((r) => toWireConfig(r, r.template));

    // No device identity participates in this response, so it is shared across every device
    // in the same audience tuple — which is what keeps it effectively free at the edge.
    return jsonOk({ schema_version: 1, configs }, 60);
  } catch {
    return failSoftConfigs();
  }
});
