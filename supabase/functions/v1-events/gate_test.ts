import { assertEquals } from "jsr:@std/assert@1";
import { mintAssertion, TTL_MS } from "../v1-attest/assertion.ts";
import { checkAttestation } from "./gate.ts";

const SECRET = "test-secret-at-least-32-bytes-long!!";
const T0 = 1_760_000_000_000;

Deno.test("policy off: no assertion needed", async () => {
  assertEquals(await checkAttestation("off", null, "a1", SECRET, T0), null);
});

Deno.test("missing assertion is refused for preferred and required", async () => {
  assertEquals(await checkAttestation("preferred", null, "a1", SECRET, T0), "attestation_required");
  assertEquals(await checkAttestation("required", "", "a1", SECRET, T0), "attestation_required");
});

// THE finding this file exists for: the gate used to check only that the header was
// non-empty, so any string passed and the whole attestation boundary was decorative.
Deno.test("a garbage assertion is refused, not accepted as present", async () => {
  assertEquals(
    await checkAttestation("required", "not-a-real-assertion", "a1", SECRET, T0),
    "attestation_invalid",
  );
  assertEquals(await checkAttestation("required", "aaa.bbb", "a1", SECRET, T0), "attestation_invalid");
});

Deno.test("a valid assertion for this app passes", async () => {
  const t = await mintAssertion("a1", "k1", SECRET, T0);
  assertEquals(await checkAttestation("required", t, "a1", SECRET, T0 + 1000), null);
});

Deno.test("an EXPIRED assertion is refused", async () => {
  const t = await mintAssertion("a1", "k1", SECRET, T0);
  assertEquals(
    await checkAttestation("required", t, "a1", SECRET, T0 + TTL_MS + 1),
    "attestation_invalid",
  );
});

// An assertion minted for a DIFFERENT app must not authorise writes to this one, or one
// tenant's genuine app could poison another tenant's impression data.
Deno.test("an assertion minted for another app is refused", async () => {
  const t = await mintAssertion("other-app", "k9", SECRET, T0);
  assertEquals(
    await checkAttestation("required", t, "a1", SECRET, T0 + 1000),
    "attestation_app_mismatch",
  );
});

Deno.test("an assertion signed with another secret is refused", async () => {
  const t = await mintAssertion("a1", "k1", "a-completely-different-secret-32b!!", T0);
  assertEquals(
    await checkAttestation("required", t, "a1", SECRET, T0 + 1000),
    "attestation_invalid",
  );
});

Deno.test("a missing server secret refuses rather than passing", async () => {
  const t = await mintAssertion("a1", "k1", SECRET, T0);
  assertEquals(await checkAttestation("required", t, "a1", undefined, T0 + 1000), "not_configured");
});
