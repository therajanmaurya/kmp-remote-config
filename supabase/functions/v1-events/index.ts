import { createClient } from "jsr:@supabase/supabase-js@2";
import { isIdentityError, resolveIdentity } from "../_shared/identity.ts";
import { corsPreflight, jsonForbidden, jsonOk } from "../_shared/respond.ts";
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
  const assertion = req.headers.get("X-RC-Attestation");
  if (id.attestationPolicy !== "off" && !assertion) {
    return jsonForbidden("attestation_required");
  }

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
        p_config: e.config_id,
        p_device: batch.device_id,
        p_type: e.type,
        p_event_id: e.event_id,
      });
      results.push({ event_id: e.event_id, applied: !error && data === true });
    } catch {
      results.push({ event_id: e.event_id, applied: false });
    }
  }

  return new Response(
    JSON.stringify({ accepted: results.filter((r) => r.applied).length, results }),
    { status: 202, headers: { "content-type": "application/json" } },
  );
});
