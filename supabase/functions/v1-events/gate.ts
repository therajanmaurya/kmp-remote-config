import type { AttestationPolicy } from "../_shared/identity.ts";
import { verifyAssertion } from "../v1-attest/assertion.ts";

/**
 * The write-path attestation gate.
 *
 * Returns null when the caller may write, or an error code string when it may not.
 *
 * This exists as its own function because the first version of /v1/events checked only
 * that `X-RC-Attestation` was NON-EMPTY — so any string passed, verifyAssertion had no
 * production consumer at all, and the attestation boundary was decorative on the one path
 * where poisoned data actually costs something. Presence is not verification.
 */
export async function checkAttestation(
  policy: AttestationPolicy,
  header: string | null,
  appId: string,
  secret: string | undefined,
  nowMs: number = Date.now(),
): Promise<string | null> {
  // An explicit opt-out (the pk_test_* development path, where Play Integrity rejects
  // sideloaded builds) is the only way to write without an assertion.
  if (policy === "off") return null;

  const token = header?.trim();
  if (!token) return "attestation_required";

  // No server secret ⇒ cannot verify ⇒ refuse. Passing here would accept every assertion
  // on a misconfigured deployment, which is the failure mode this whole gate exists for.
  if (!secret) return "not_configured";

  const claims = await verifyAssertion(token, secret, nowMs);
  // Covers forged signatures, tampered payloads, and EXPIRED assertions alike — expiry is
  // a refusal, never silently treated as "absent" (which for `preferred` would pass).
  if (!claims) return "attestation_invalid";

  // An assertion minted for a different app must not authorise writes to this one, or one
  // tenant's genuine app could poison another tenant's impression data.
  if (claims.appId !== appId) return "attestation_app_mismatch";

  return null;
}
