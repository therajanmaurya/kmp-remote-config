import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  consumeRateLimit,
  deviceSubject,
  EVENTS_PER_MIN_PER_DEVICE,
  EVENTS_PER_MIN_PER_KEY,
  eventsSubject,
  readSubject,
  WINDOW_SECONDS,
} from "./rate-limit.ts";

/**
 * The stub RECORDS the RPC arguments and the assertions read them back.
 *
 * Finding M3 was exactly this gap in the identity stub: it ignored .eq()/.is()
 * arguments, so deleting the revoked-key filter from the production code still passed
 * every test. A limiter stub that ignores its arguments has the same defect — the
 * subject and the limit are the whole behaviour, and a test that does not assert them
 * would stay green if both were swapped.
 */
function stubDb(row: unknown, error: unknown = null) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    db: {
      // deno-lint-ignore no-explicit-any
      rpc(name: string, args: Record<string, unknown>): any {
        calls.push({ name, ...args });
        return Promise.resolve({ data: row, error });
      },
    },
  };
}

const ROW = (allowed: boolean, remaining: number) => [{
  allowed,
  remaining,
  reset_at: "2026-10-05T12:00:00.000Z",
}];

Deno.test("passes the subject, limit and window straight through to the RPC", async () => {
  const { db, calls } = stubDb(ROW(true, 59));
  await consumeRateLimit(db, "key:k1:read", 60);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "consume_rate_limit");
  assertEquals(calls[0].p_subject, "key:k1:read");
  assertEquals(calls[0].p_limit, 60);
  assertEquals(calls[0].p_window_seconds, WINDOW_SECONDS);
});

Deno.test("reports the row's verdict verbatim", async () => {
  const { db } = stubDb(ROW(true, 59));
  assertEquals(await consumeRateLimit(db, "key:k1:read", 60), {
    allowed: true,
    limit: 60,
    remaining: 59,
    resetAt: "2026-10-05T12:00:00.000Z",
  });
});

Deno.test("a denial is reported as denied", async () => {
  const { db } = stubDb(ROW(false, 0));
  const v = await consumeRateLimit(db, "key:k1:read", 60);
  assertEquals(v.allowed, false);
  assertEquals(v.remaining, 0);
});

Deno.test("a single object (not an array) is accepted too", async () => {
  // Guards against a supabase-js version that unwraps a one-row RETURNS TABLE.
  const { db } = stubDb({ allowed: false, remaining: 0, reset_at: "2026-10-05T12:00:00.000Z" });
  assertEquals((await consumeRateLimit(db, "key:k1:read", 60)).allowed, false);
});

Deno.test("FAILS OPEN when the RPC errors", async () => {
  // The limiter is cost control, not the authorization boundary. A limiter outage must
  // not become a product outage — the key binding and the attestation gate are untouched
  // by this path and still hold.
  const { db } = stubDb(null, { message: "connection refused" });
  const v = await consumeRateLimit(db, "key:k1:read", 60);
  assert(v.allowed, "an unreachable limiter must admit the request");
  assertEquals(v.remaining, 60);
  assert(new Date(v.resetAt).getTime() > Date.now(), "resetAt must still be in the future");
});

Deno.test("FAILS OPEN when the RPC returns no row", async () => {
  const { db } = stubDb([]);
  assert((await consumeRateLimit(db, "key:k1:read", 60)).allowed);
});

Deno.test("FAILS OPEN when the RPC throws", async () => {
  const db = {
    rpc() {
      throw new Error("boom");
    },
  };
  // deno-lint-ignore no-explicit-any
  assert((await consumeRateLimit(db as any, "key:k1:read", 60)).allowed);
});

Deno.test("a non-numeric remaining degrades to 0 rather than NaN", async () => {
  // NaN would serialize into X-RateLimit-Remaining and a client parsing it would
  // compute a NaN backoff.
  const { db } = stubDb([{ allowed: true, remaining: null, reset_at: "2026-10-05T12:00:00.000Z" }]);
  assertEquals((await consumeRateLimit(db, "key:k1:read", 60)).remaining, 0);
});

Deno.test("subjects are distinct per key, per purpose, and per device", async () => {
  // Reads and events must not share a bucket: 600 events/min would otherwise consume the
  // 60/min read quota ten times over and black out config fetches.
  assert(readSubject("k1") !== eventsSubject("k1"));
  assertEquals(readSubject("k1"), "key:k1:read");
  assertEquals(eventsSubject("k1"), "key:k1:events");
  assertEquals(deviceSubject("a1", "d1"), "device:a1:d1");
  // Two devices in the same app are separate; the same device in two apps is separate.
  assert(deviceSubject("a1", "d1") !== deviceSubject("a1", "d2"));
  assert(deviceSubject("a1", "d1") !== deviceSubject("a2", "d1"));
});

Deno.test("a long device_id is bounded — subject is a PRIMARY KEY", async () => {
  const subject = deviceSubject("a1", "x".repeat(5000));
  assert(subject.length < 250, `subject was ${subject.length} chars; a caller could bloat the PK index`);
});

Deno.test("the O2 constants are the documented numbers", async () => {
  // Pinned so a casual edit to "tune" them is a visible test change rather than a silent
  // policy shift.
  assertEquals(EVENTS_PER_MIN_PER_KEY, 600);
  assertEquals(EVENTS_PER_MIN_PER_DEVICE, 120);
  assertEquals(WINDOW_SECONDS, 60);
});
