import type { AttestationPolicy } from "./identity.ts";
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
  keyId: string,
  secret: string | undefined,
  nowMs: number = Date.now(),
): Promise<string | null> {
  // `off` is the explicit opt-out: the rck_test_* development path, where Play Integrity
  // rejects sideloaded builds.
  if (policy === "off") return null;

  const token = header?.trim();
  if (!token) {
    // RULING (I8): `preferred` ALLOWS an absent assertion; only `required` demands one.
    //
    // The spec contradicts itself — §7.3's headline says attestation is "required on
    // /v1/events", while its own platform table says desktop/JS/wasm "falls back to
    // asserted identity" and §8.2 says "required PER KEY POLICY". Reading `preferred` as
    // refuse-if-absent bricks the write path for all real traffic: every key defaults to
    // `preferred`, and desktop/web/wasm can never mint an assertion at all (/v1/attest
    // refuses attestation_unsupported_platform), so those platforms could never record an
    // event. A PRESENT-but-invalid token is still refused below, so "expiry is a refusal,
    // never treated as absent" is preserved.
    return policy === "required" ? "attestation_required" : null;
  }

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

  // …and it is bound to the KEY it was minted for, not merely the app. Comparing only the
  // app id made per-key revocation not actually revoke: revoke key A, and an assertion
  // minted with A keeps working when presented alongside key B of the same app.
  if (claims.keyId !== keyId) return "attestation_key_mismatch";

  return null;
}
