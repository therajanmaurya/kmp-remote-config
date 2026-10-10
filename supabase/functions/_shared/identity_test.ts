import { assertEquals } from "jsr:@std/assert@1";
import { resolveIdentity } from "./identity.ts";

// Minimal stub standing in for the single `app_key` lookup resolveIdentity performs.
function dbStub(row: Record<string, unknown> | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          }),
        }),
      }),
    }),
    // deno-lint-ignore no-explicit-any
  } as any;
}

const KEY_ROW = {
  id: "k1",
  app_id: "a1",
  environment: "live",
  platform: "android",
  bundle_id: "com.example.app",
  cert_digests: ["AA:BB"],
  attestation_policy: "preferred",
  rate_limit_per_min: 60,
};

function headers(extra: Record<string, string> = {}) {
  return new Headers({
    "X-RC-Key": "rck_live_x",
    "X-RC-Package": "com.example.app",
    "X-RC-Cert": "AA:BB",
    "X-RC-Platform": "android",
    "X-RC-SDK-Version": "4.0.0",
    ...extra,
  });
}

Deno.test("resolves a valid key", async () => {
  const r = await resolveIdentity(dbStub(KEY_ROW), headers());
  assertEquals("appId" in r, true);
});

Deno.test("missing key → 403 key_missing", async () => {
  const h = headers();
  h.delete("X-RC-Key");
  assertEquals(await resolveIdentity(dbStub(KEY_ROW), h), { status: 403, code: "key_missing" });
});

// Review Focus #3 — a revoked key must 403, never an empty list. An empty list reads as
// "nothing to show" and the integrator never learns the key is dead. The query filters on
// `revoked_at IS NULL`, so a revoked key returns no row — indistinguishable from unknown,
// which is the correct posture: both are "this key cannot be used".
Deno.test("revoked or unknown key → 403 key_invalid", async () => {
  assertEquals(await resolveIdentity(dbStub(null), headers()), { status: 403, code: "key_invalid" });
});

Deno.test("package mismatch → 403 package_mismatch", async () => {
  assertEquals(
    await resolveIdentity(dbStub(KEY_ROW), headers({ "X-RC-Package": "com.evil.app" })),
    { status: 403, code: "package_mismatch" },
  );
});

Deno.test("cert digest not in the registered set → 403 cert_mismatch", async () => {
  assertEquals(
    await resolveIdentity(dbStub(KEY_ROW), headers({ "X-RC-Cert": "ZZ:ZZ" })),
    { status: 403, code: "cert_mismatch" },
  );
});

Deno.test("cert is not required on a platform that has none", async () => {
  const row = { ...KEY_ROW, platform: "ios", cert_digests: [] };
  const h = headers({ "X-RC-Platform": "ios" });
  h.delete("X-RC-Cert");
  assertEquals("appId" in await resolveIdentity(dbStub(row), h), true);
});

// M7 — app_key.platform read like a constraint and was advisory: a key pinned to `android`
// could present X-RC-Platform: web and receive web-targeted configs. Low impact (the
// content is public by design) but a column that looks like a constraint should be one.
Deno.test("platform mismatch against a pinned key → 403 platform_mismatch", async () => {
  assertEquals(
    await resolveIdentity(dbStub(KEY_ROW), headers({ "X-RC-Platform": "web" })),
    { status: 403, code: "platform_mismatch" },
  );
});

Deno.test("a key with no pinned platform accepts any asserted platform", async () => {
  const row = { ...KEY_ROW, platform: null, cert_digests: [] };
  const h = headers({ "X-RC-Platform": "web" });
  h.delete("X-RC-Cert");
  assertEquals("appId" in await resolveIdentity(dbStub(row), h), true);
});

// ── One key per app (migration 021) ─────────────────────────────────────────────────────────
// A single platform-agnostic key now serves every target of a Kotlin Multiplatform app. The
// cert-digest check had to be scoped to callers asserting android, and these pin both halves of
// that: the one way the change could break a working app, and the protection it must not lose.

Deno.test("a shared key with android digests still serves a non-android caller", async () => {
  // THE regression risk in one-key-per-app. iOS, desktop and web never send X-RC-Cert, so a
  // digest check driven by the KEY alone would 403 every one of them the moment the app moved
  // off per-platform keys — and the operator's only clue would be cert_mismatch on a platform
  // that has no certificates at all.
  const shared = { ...KEY_ROW, platform: null };
  const h = new Headers({
    "X-RC-Key": "rck_live_x",
    "X-RC-Package": "com.example.app",
    "X-RC-Platform": "ios",
    "X-RC-SDK-Version": "4.0.0",
  });
  const r = await resolveIdentity(dbStub(shared), h);
  assertEquals("appId" in r, true);
});

Deno.test("a shared key still enforces digests against an android caller", async () => {
  // The protection the scoping must not give away: an honest android caller presenting the
  // wrong signing certificate is still refused.
  const shared = { ...KEY_ROW, platform: null };
  const r = await resolveIdentity(dbStub(shared), headers({ "X-RC-Cert": "ZZ:ZZ" }));
  assertEquals(r, { status: 403, code: "cert_mismatch" });
});

Deno.test("a shared key accepts every platform the app ships on", async () => {
  // `platform: null` means "any" — the property that let one key replace five.
  const shared = { ...KEY_ROW, platform: null, cert_digests: [] };
  for (const p of ["android", "ios", "desktop", "web", "wasm"]) {
    const h = new Headers({
      "X-RC-Key": "rck_live_x",
      "X-RC-Package": "com.example.app",
      "X-RC-Platform": p,
      "X-RC-SDK-Version": "4.0.0",
    });
    const r = await resolveIdentity(dbStub(shared), h);
    assertEquals("appId" in r, true, `${p} was refused by an all-platform key`);
  }
});
