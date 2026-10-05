// Parsing lives in its own module so it can be unit-tested without importing index.ts,
// whose top-level Deno.serve would start a listener during the test run.

export const TYPES = ["impression", "dismiss", "ack", "action"] as const;
export type EventType = typeof TYPES[number];

export interface EventIn {
  event_id: string;
  config_id: string;
  type: EventType;
}

/** One request may not carry unbounded work; the client batches and retries. */
export const MAX_BATCH = 100;

export function parseEventBatch(
  body: unknown,
): { device_id: string; events: EventIn[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const device = typeof b.device_id === "string" ? b.device_id.trim() : "";
  if (!device) return null;

  if (!Array.isArray(b.events) || b.events.length > MAX_BATCH) return null;

  const events: EventIn[] = [];
  for (const raw of b.events) {
    if (typeof raw !== "object" || raw === null) return null;
    const e = raw as Record<string, unknown>;
    // event_id is REQUIRED: retry dedupe is per event, so without it a retried impression
    // is indistinguishable from a genuine second showing and max_impressions becomes a lie.
    if (typeof e.event_id !== "string" || !e.event_id.trim()) return null;
    if (typeof e.config_id !== "string" || !e.config_id.trim()) return null;
    if (typeof e.type !== "string" || !TYPES.includes(e.type as EventType)) return null;
    events.push({
      event_id: e.event_id.trim(),
      config_id: e.config_id.trim(),
      type: e.type as EventType,
    });
  }
  return { device_id: device, events };
}
