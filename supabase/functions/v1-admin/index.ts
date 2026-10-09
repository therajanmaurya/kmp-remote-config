import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * v1-admin — the HTTP front door for access-token-bearing clients (the MCP server, CI, scripts).
 *
 * WHY THIS EXISTS
 * The MCP server used to hold a SERVICE-ROLE key on a developer's laptop and enforce the token's
 * scope in its own process. Three problems: that machine held a credential bypassing every RLS
 * policy; enforcement lived in one TypeScript function, so a bug or a forgotten call meant none;
 * and identity was memoised per process, so a revoked token worked until the next restart.
 *
 * Migration 017 moved authorization into `api.rconfig_api`, which authenticates and authorizes
 * before it looks at which operation was requested. This function is the thin shim that lets a
 * client reach it over HTTPS holding ONLY an access token — no Supabase key of any kind.
 *
 * The service-role key still exists, but it lives HERE, in Supabase's own edge runtime, which is
 * where `v1-configs` and `v1-events` already keep theirs. That is a managed server-side secret
 * rather than one sitting in a laptop's environment, and it never reaches a client.
 *
 * This function deliberately holds NO authorization logic of its own. It extracts the bearer
 * token, forwards it, and returns what the database decided. Any check added here would be a
 * second place to get authorization wrong — the exact failure migration 017 removed.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "use POST" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !svc) return json({ error: "the control plane is misconfigured" }, 500);

  // `Bearer rcp_…`. Checked for SHAPE only — whether it is live, scoped or permitted is the
  // database's call, and duplicating any part of that decision here is how the two drift.
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!/^rcp_[A-Za-z0-9]{40}$/.test(token)) {
    return json({
      error: /^rck_/.test(token)
        ? "that is a publishable key (rck_…), which is PUBLIC and belongs in your app's source. " +
          "Authenticate with an access token (rcp_…) from Account → Access Tokens."
        : "send an access token as 'Authorization: Bearer rcp_…'.",
    }, 401);
  }

  let body: { op?: string; args?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "the request body must be JSON: { op, args }" }, 400);
  }
  if (!body?.op) return json({ error: "name an operation: { op, args }" }, 400);

  const db = createClient(url, svc, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("rconfig_api", {
    p_token: token,
    p_op: body.op,
    p_args: body.args ?? {},
  });

  // A transport/database failure is NOT a refusal. Reporting it as one sends the caller off to
  // regenerate a token that was fine.
  if (error) return json({ error: `the control plane could not answer: ${error.message}` }, 502);

  // The funnel's own refusals come back as { error } with a 200 from PostgREST; map them to 403
  // so an HTTP client sees the right shape without this function re-deciding anything.
  const envelope = (data ?? {}) as { data?: unknown; error?: string };
  if (envelope.error) return json({ error: envelope.error }, 403);
  return json({ data: envelope.data });
});
