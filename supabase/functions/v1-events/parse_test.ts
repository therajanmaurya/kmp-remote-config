import { assertEquals } from "jsr:@std/assert@1";
import { MAX_BATCH, parseEventBatch } from "./parse.ts";

Deno.test("accepts a well-formed batch", () => {
  const r = parseEventBatch({
    device_id: "d1",
    events: [{ event_id: "e1", config_id: "c1", type: "impression" }],
  });
  assertEquals(r?.events.length, 1);
  assertEquals(r?.device_id, "d1");
});

Deno.test("rejects a batch with no device_id", () => {
  assertEquals(parseEventBatch({ events: [] }), null);
  assertEquals(parseEventBatch({ device_id: "   ", events: [] }), null);
});

// event_id is what makes retry dedupe possible at all: without it a retried impression is
// indistinguishable from a genuine second showing, and max_impressions becomes a lie.
Deno.test("rejects an event missing event_id", () => {
  assertEquals(
    parseEventBatch({ device_id: "d1", events: [{ config_id: "c1", type: "impression" }] }),
    null,
  );
  assertEquals(
    parseEventBatch({ device_id: "d1", events: [{ event_id: "  ", config_id: "c1", type: "impression" }] }),
    null,
  );
});

Deno.test("rejects an unknown event type", () => {
  assertEquals(
    parseEventBatch({ device_id: "d1", events: [{ event_id: "e", config_id: "c", type: "explode" }] }),
    null,
  );
});

Deno.test("accepts all four known event types", () => {
  for (const type of ["impression", "dismiss", "ack", "action"]) {
    const r = parseEventBatch({ device_id: "d1", events: [{ event_id: "e", config_id: "c", type }] });
    assertEquals(r?.events[0].type, type);
  }
});

Deno.test("caps batch size so one request cannot carry unbounded work", () => {
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ event_id: `e${i}`, config_id: "c", type: "impression" }));
  assertEquals(parseEventBatch({ device_id: "d1", events: mk(MAX_BATCH) })?.events.length, MAX_BATCH);
  assertEquals(parseEventBatch({ device_id: "d1", events: mk(MAX_BATCH + 1) }), null);
});

Deno.test("rejects a non-object body", () => {
  assertEquals(parseEventBatch(null), null);
  assertEquals(parseEventBatch("nope"), null);
  assertEquals(parseEventBatch(42), null);
});
