import { createClient } from "jsr:@supabase/supabase-js@2";
import { isIdentityError, resolveIdentity } from "../_shared/identity.ts";
import { corsPreflight, jsonForbidden, jsonOk } from "../_shared/respond.ts";
import { checkAttestation } from "../_shared/attestation-gate.ts";
import { parseEventBatch } from "./parse.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return jsonForbidden("method_not_allowed");

  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // Unlike /v1/configs there is nothing to fail soft INTO here — dropping events silently
  // would make impression counts quietly wrong — but a missing binding is still an
  // operator fault, so report zero accepted rather than a 5xx the client will retry-storm.
  if (!url || !svc) return jsonOk({ accepted: 0, results: [] });

  const db = createClient(url, svc, { auth: { persistSession: false } });

  const id = await resolveIdentity(db, req.headers);
  if (isIdentityError(id)) return jsonForbidden(id.code);

  // Attestation is REQUIRED on writes for any key not explicitly set to `off`. This is the
  // path where poisoned data has a cost, so it carries the hard boundary; reads stay
  // cacheable and policy-driven.
  //
  // checkAttestation VERIFIES the assertion — signature, expiry, and that it was minted
  // for THIS app. An earlier version checked only that the header was non-empty, which
  // meant any string passed and the boundary was decorative.
  const gate = await checkAttestation(
    id.attestationPolicy,
    req.headers.get("X-RC-Attestation"),
    id.appId,
    Deno.env.get("RC_ASSERTION_SECRET"),
  );
  if (gate) return jsonForbidden(gate);

  let batch: ReturnType<typeof parseEventBatch>;
  try {
    batch = parseEventBatch(await req.json());
  } catch {
    batch = null;
  }
  if (!batch) return jsonForbidden("malformed_batch");

  const results: { event_id: string; applied: boolean }[] = [];
  for (const e of batch.events) {
    // A rejected event never fails the batch — one unknown config id must not discard the
    // rest of a device's queued events.
    try {
      const { data, error } = await db.rpc("record_event", {
        // p_app scopes the write to the app resolved from the key. Without it the client's
        // config_id alone decided the tenant, and any valid key could write anywhere.
        p_app: id.appId,
        p_config: e.config_id,
        p_device: batch.device_id,
        p_type: e.type,
        p_event_id: e.event_id,
      });
      results.push({ event_id: e.event_id, applied: !error && data === true });
    } catch (err) {
      // Shape only: which stage failed and the error class. Never the config id or device id.
      console.error(JSON.stringify({
        route: "v1-events",
        stage: "record_event",
        error: err instanceof Error ? err.name : undefined,
      }));
      results.push({ event_id: e.event_id, applied: false });
    }
  }

  // Built via jsonOk so the CORS set is defined in ONE place. Hand-rolling the headers here
  // meant OPTIONS passed preflight and then the browser blocked the actual 202 — the silent
  // half of a CORS failure, and §14 requires this to serve a browser consumer.
  return jsonOk({ accepted: results.filter((r) => r.applied).length, results }, 0, 202);
});
