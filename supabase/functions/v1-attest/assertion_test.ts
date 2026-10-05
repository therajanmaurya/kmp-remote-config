import { assertEquals } from "jsr:@std/assert@1";
import { mintAssertion, TTL_MS, verifyAssertion } from "./assertion.ts";

const SECRET = "test-secret-at-least-32-bytes-long!!";
const T0 = 1_760_000_000_000;

Deno.test("a freshly minted assertion verifies", async () => {
  const t = await mintAssertion("a1", "k1", SECRET, T0);
  assertEquals(await verifyAssertion(t, SECRET, T0 + 1000), { appId: "a1", keyId: "k1" });
});

// Review Focus #5 — an EXPIRED assertion must be REJECTED, not treated as absent. For a
// `preferred` key, "absent" would silently pass; a replayed stale token must not. A client
// with a backgrounded app or a slow clock will replay one.
Deno.test("an assertion past its life is rejected, and valid right up to the boundary", async () => {
  const t = await mintAssertion("a1", "k1", SECRET, T0);
  assertEquals(await verifyAssertion(t, SECRET, T0 + TTL_MS + 1), null);
  assertEquals(await verifyAssertion(t, SECRET, T0 + TTL_MS - 1), { appId: "a1", keyId: "k1" });
});

Deno.test("a tampered assertion is rejected", async () => {
  const t = await mintAssertion("a1", "k1", SECRET, T0);
  const [p] = t.split(".");
  assertEquals(await verifyAssertion(`${p}.deadbeef`, SECRET, T0 + 1000), null);
});

Deno.test("an assertion minted with another secret is rejected", async () => {
  const t = await mintAssertion("a1", "k1", "another-secret-at-least-32-bytes!!!", T0);
  assertEquals(await verifyAssertion(t, SECRET, T0 + 1000), null);
});

Deno.test("a clock EARLIER than issuance beyond skew is rejected", async () => {
  const t = await mintAssertion("a1", "k1", SECRET, T0);
  assertEquals(await verifyAssertion(t, SECRET, T0 - 60_001), null);
  // …but a minute of skew is tolerated, because client clocks drift
  assertEquals(await verifyAssertion(t, SECRET, T0 - 30_000), { appId: "a1", keyId: "k1" });
});

Deno.test("a malformed token is rejected rather than throwing", async () => {
  assertEquals(await verifyAssertion("", SECRET, T0), null);
  assertEquals(await verifyAssertion("no-dot", SECRET, T0), null);
  assertEquals(await verifyAssertion("!!!.!!!", SECRET, T0), null);
});
