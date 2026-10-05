// deno-lint-ignore-file no-explicit-any
export type AttestationPolicy = "required" | "preferred" | "off";

export interface Identity {
  appId: string;
  keyId: string;
  environment: "live" | "test";
  platform: string | null;
  attestationPolicy: AttestationPolicy;
  rateLimitPerMin: number;
}

export interface IdentityError {
  status: 403;
  code: string;
}

export function isIdentityError(x: Identity | IdentityError): x is IdentityError {
  return (x as IdentityError).status === 403;
}

/**
 * Resolves the publishable key to an app and verifies the caller's asserted identity.
 *
 * The Edge Function runs as service_role, so RLS is bypassed and THIS is the authorization
 * boundary: every downstream query must be scoped by the returned appId. Nothing below
 * this function re-checks tenancy.
 */
export async function resolveIdentity(
  db: any,
  h: Headers,
): Promise<Identity | IdentityError> {
  const key = h.get("X-RC-Key")?.trim();
  if (!key) return { status: 403, code: "key_missing" };

  const { data, error } = await db
    .from("app_key")
    .select(
      "id, app_id, environment, platform, bundle_id, cert_digests, attestation_policy, rate_limit_per_min",
    )
    .eq("key", key)
    // A revoked key returns no row, so it is indistinguishable from an unknown one —
    // which is the right posture: both mean "this key cannot be used". Critically this
    // is a 403, not an empty config list; an empty list reads as "nothing to show" and
    // the integrator never learns the key is dead.
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) return { status: 403, code: "key_invalid" };

  const pkg = h.get("X-RC-Package")?.trim();
  if (data.bundle_id && data.bundle_id !== pkg) {
    return { status: 403, code: "package_mismatch" };
  }

  // Only Android reports a signing certificate. Requiring one everywhere would reject
  // every legitimate iOS / desktop / web caller, so the check is driven by whether the
  // KEY registers any digests rather than by the platform header.
  const digests: string[] = data.cert_digests ?? [];
  if (digests.length > 0) {
    const cert = h.get("X-RC-Cert")?.trim();
    if (!cert || !digests.includes(cert)) return { status: 403, code: "cert_mismatch" };
  }

  return {
    appId: data.app_id,
    keyId: data.id,
    environment: data.environment,
    platform: data.platform ?? null,
    attestationPolicy: data.attestation_policy,
    rateLimitPerMin: data.rate_limit_per_min,
  };
}
