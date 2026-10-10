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

  // app_key.platform is a CONSTRAINT, not a hint. It previously read like one and was
  // advisory: a key pinned to `android` could assert X-RC-Platform: web and receive
  // web-targeted configs. A null platform still means "any".
  if (data.platform) {
    const asserted = h.get("X-RC-Platform")?.trim();
    if (asserted !== data.platform) return { status: 403, code: "platform_mismatch" };
  }

  // Only Android reports a signing certificate, so the digest check is scoped to callers
  // ASSERTING android — not merely to keys that happen to carry digests.
  //
  // It used to key off the key alone, which was correct while every key was pinned to one
  // platform: only the android key had digests, so only android callers met the check. Once a
  // single key serves the whole app (migration 021) that same rule rejects every iOS, desktop
  // and web caller, because none of them send `X-RC-Cert` — the one way one-key-per-app could
  // break a working integration.
  //
  // Scoping to the asserted platform is not a weakening. A caller willing to lie about its
  // platform could always have asserted a different one and presented that platform's key; the
  // digest binding only ever protected callers who were honestly android. Play Integrity and
  // App Attest are what actually bind a caller to a build, and they run in the attestation gate.
  const digests: string[] = data.cert_digests ?? [];
  const assertedPlatform = h.get("X-RC-Platform")?.trim();
  if (digests.length > 0 && assertedPlatform === "android") {
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
