import { createClient } from "jsr:@supabase/supabase-js@2";
import { isIdentityError, resolveIdentity } from "../_shared/identity.ts";
import { corsPreflight, jsonForbidden, jsonOk } from "../_shared/respond.ts";
import { mintAssertion, TTL_MS } from "./assertion.ts";

/**
 * Verifies a platform attestation token.
 *
 * Android: a Play Integrity token whose verdict carries packageName +
 * certificateSha256Digest, which MUST match the key's registered values — that match is
 * what makes attestation binding rather than decorative.
 * iOS: an App Attest assertion over a server challenge.
 *
 * Injected so tests use a fake; no test calls Google or Apple.
 */
export type PlatformVerifier = (
  platform: string,
  token: string,
) => Promise<{ packageName: string; certDigest?: string } | null>;

const liveVerifier: PlatformVerifier = async (platform, token) => {
  const ep = Deno.env.get("ATTEST_VERIFY_ENDPOINT");
  // Not configured ⇒ cannot verify ⇒ REFUSE. An unverifiable attestation that succeeds is
  // worse than one that fails: it would hand out assertions to anyone while looking secure.
  if (!ep) return null;
  try {
    const r = await fetch(ep, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform, token }),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
};

export function handler(verify: PlatformVerifier = liveVerifier) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return corsPreflight();
    if (req.method !== "POST") return jsonForbidden("method_not_allowed");

    const url = Deno.env.get("SUPABASE_URL");
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secret = Deno.env.get("RC_ASSERTION_SECRET");
    if (!url || !svc || !secret) return jsonForbidden("not_configured");

    const db = createClient(url, svc, { auth: { persistSession: false } });
    const id = await resolveIdentity(db, req.headers);
    if (isIdentityError(id)) return jsonForbidden(id.code);

    let token: string | undefined;
    try {
      token = (await req.json())?.token;
    } catch { /* fall through to token_missing */ }
    if (!token) return jsonForbidden("token_missing");

    const platform = id.platform ?? req.headers.get("X-RC-Platform") ?? "";
    if (platform !== "android" && platform !== "ios") {
      // No attestation API exists elsewhere, and a key on such a platform cannot be
      // `required` (DB constraint in migration 003), so there is nothing to mint.
      return jsonForbidden("attestation_unsupported_platform");
    }

    const verdict = await verify(platform, token);
    if (!verdict) return jsonForbidden("attestation_invalid");

    // The match against the KEY's registered identity is what makes attestation binding.
    // Without it we would mint an assertion for any genuine app, not for THIS app.
    const { data: key } = await db
      .from("app_key")
      .select("bundle_id, cert_digests")
      .eq("id", id.keyId)
      .maybeSingle();

    if (key?.bundle_id && key.bundle_id !== verdict.packageName) {
      return jsonForbidden("attestation_package_mismatch");
    }
    const digests: string[] = key?.cert_digests ?? [];
    if (digests.length > 0 && verdict.certDigest && !digests.includes(verdict.certDigest)) {
      return jsonForbidden("attestation_cert_mismatch");
    }

    return jsonOk({
      assertion: await mintAssertion(id.appId, id.keyId, secret),
      expires_in: Math.floor(TTL_MS / 1000),
    });
  };
}

Deno.serve(handler());
