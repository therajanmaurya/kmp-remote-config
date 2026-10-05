import { assertEquals } from "jsr:@std/assert@1";
import { mintAssertion, TTL_MS } from "../v1-attest/assertion.ts";
import { checkAttestation } from "./attestation-gate.ts";

const SECRET = "test-secret-at-least-32-bytes-long!!";
const T0 = 1_760_000_000_000;

Deno.test("policy off: no assertion needed", async () => {
  assertEquals(await checkAttestation("off", null, "a1", "k1", SECRET, T0), null);
});

Deno.test("required refuses a missing assertion", async () => {
  assertEquals(await checkAttestation("required", null, "a1", "k1", SECRET, T0), "attestation_required");
  assertEquals(await checkAttestation("required", "", "a1", "k1", SECRET, T0), "attestation_required");
});

// RULING (I8): `preferred` means VERIFY IF PRESENT, not refuse-if-absent.
// The spec contradicts itself — §7.3's headline says attestation is "required on
// /v1/events" while its own platform table says desktop/JS/wasm "falls back to asserted
// identity", and §8.2 says "required PER KEY POLICY". Taking the refuse reading bricks the
// write path for 100% of real traffic: every key defaults to `preferred`, and
// desktop/web/wasm can NEVER mint an assertion (/v1/attest 403s
// attestation_unsupported_platform), so they would be permanently unable to record events.
Deno.test("preferred ALLOWS an absent assertion", async () => {
  assertEquals(await checkAttestation("preferred", null, "a1", "k1", SECRET, T0), null);
  assertEquals(await checkAttestation("preferred", "", "a1", "k1", SECRET, T0), null);
});

// …but a PRESENT-and-bad one is still refused, so "expiry is a refusal, never treated as
// absent" survives the ruling. This is the half that matters for review-focus #5.
Deno.test("preferred REFUSES a present-but-invalid assertion", async () => {
  assertEquals(await checkAttestation("preferred", "garbage", "a1", "k1", SECRET, T0), "attestation_invalid");
  const expired = await mintAssertion("a1", "k1", SECRET, T0);
  assertEquals(
    await checkAttestation("preferred", expired, "a1", "k1", SECRET, T0 + TTL_MS + 1),
    "attestation_invalid",
  );
});

// THE finding this file exists for: the gate used to check only that the header was
// non-empty, so any string passed and the whole attestation boundary was decorative.
Deno.test("a garbage assertion is refused, not accepted as present", async () => {
  assertEquals(
    await checkAttestation("required", "not-a-real-assertion", "a1", "k1", SECRET, T0),
    "attestation_invalid",
  );
  assertEquals(await checkAttestation("required", "aaa.bbb", "a1", "k1", SECRET, T0), "attestation_invalid");
});

Deno.test("a valid assertion for this app passes", async () => {
  const t = await mintAssertion("a1", "k1", SECRET, T0);
  assertEquals(await checkAttestation("required", t, "a1", "k1", SECRET, T0 + 1000), null);
});

Deno.test("an EXPIRED assertion is refused", async () => {
  const t = await mintAssertion("a1", "k1", SECRET, T0);
  assertEquals(
    await checkAttestation("required", t, "a1", "k1", SECRET, T0 + TTL_MS + 1),
    "attestation_invalid",
  );
});

// An assertion minted for a DIFFERENT app must not authorise writes to this one, or one
// tenant's genuine app could poison another tenant's impression data.
Deno.test("an assertion minted for another app is refused", async () => {
  const t = await mintAssertion("other-app", "k9", SECRET, T0);
  assertEquals(
    await checkAttestation("required", t, "a1", "k1", SECRET, T0 + 1000),
    "attestation_app_mismatch",
  );
});

Deno.test("an assertion signed with another secret is refused", async () => {
  const t = await mintAssertion("a1", "k1", "a-completely-different-secret-32b!!", T0);
  assertEquals(
    await checkAttestation("required", t, "a1", "k1", SECRET, T0 + 1000),
    "attestation_invalid",
  );
});

Deno.test("a missing server secret refuses rather than passing", async () => {
  const t = await mintAssertion("a1", "k1", SECRET, T0);
  assertEquals(await checkAttestation("required", t, "a1", "k1", undefined, T0 + 1000), "not_configured");
});

// M10 — the gate compared only claims.appId, so an assertion minted via one key authorised
// writes through ANY key of the same app. Harmless within a tenant, but it makes per-key
// revocation not actually revoke: revoke key A, and an assertion minted with A still works
// when presented alongside key B.
Deno.test("an assertion minted for another KEY of the same app is refused", async () => {
  const t2 = await mintAssertion("a1", "other-key", SECRET, T0);
  assertEquals(
    await checkAttestation("required", t2, "a1", "k1", SECRET, T0 + 1000),
    "attestation_key_mismatch",
  );
});
