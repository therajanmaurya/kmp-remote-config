const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-rc-key, x-rc-package, x-rc-cert, x-rc-platform, x-rc-app-version, x-rc-sdk-version, x-rc-device, x-rc-attestation",
  "Vary": "Origin",
};

export function jsonOk(body: unknown, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...CORS,
      "content-type": "application/json",
      ...(cacheSeconds > 0 ? { "Cache-Control": `public, max-age=${cacheSeconds}` } : {}),
    },
  });
}

/**
 * 403 is reserved for IDENTITY mismatch — a bad key, package, cert, or a missing
 * required attestation. A misconfigured key must be LOUD at integration time rather
 * than silent in production, which is why this is not folded into the empty-set response.
 */
export function jsonForbidden(code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status: 403,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

/**
 * Fail-soft: any INTERNAL fault returns an empty config set, never an error status.
 * A config surface must never become an error surface.
 *
 * Short cache (10s, not the happy path's 60s) so a transient fault is not pinned at the
 * edge for a full minute.
 */
export function failSoftConfigs(): Response {
  return jsonOk({ schema_version: 1, configs: [] }, 10);
}

export function corsPreflight(): Response {
  return new Response("ok", { headers: CORS });
}
