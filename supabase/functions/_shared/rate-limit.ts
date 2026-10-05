// deno-lint-ignore-file no-explicit-any
/**
 * Rate limiting against the shared Postgres bucket (migration 008, spec §8.2, O2).
 *
 * The counting lives in SQL because a Deno isolate's memory is per-instance: an
 * in-isolate counter divides the real limit by however many isolates are warm, so a
 * "60/min" rule admits 60 × N. See 008_rate_limit.sql for the full reasoning and the
 * fixed-window ceiling this accepts.
 */

/** O2: 60 req/min/key for reads — but reads read it from app_key.rate_limit_per_min,
 *  which defaults to 60, so an operator can tune one noisy integration without a deploy. */
export const WINDOW_SECONDS = 60;

/** O2: 600/min for events, per key. Not a column: unlike the read limit there is no
 *  per-integration reason to tune it, and an operator raising their own write quota is
 *  the one direction we do not want self-service. */
export const EVENTS_PER_MIN_PER_KEY = 600;

/** O2: 120/min per device. Catches a single looping client that the per-key limit would
 *  hide inside a large app's legitimate aggregate. */
export const EVENTS_PER_MIN_PER_DEVICE = 120;

/** A device_id is caller-supplied. record_event bounds it at 200 (finding C2); the
 *  subject column is a PRIMARY KEY, so the same bound applies here or a caller can bloat
 *  the index at will. */
const DEVICE_ID_MAX = 200;

export interface RateVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** ISO-8601. The end of the current window, so Retry-After is always positive. */
  resetAt: string;
}

export function readSubject(keyId: string): string {
  return `key:${keyId}:read`;
}

export function eventsSubject(keyId: string): string {
  return `key:${keyId}:events`;
}

export function deviceSubject(appId: string, deviceId: string): string {
  return `device:${appId}:${deviceId.slice(0, DEVICE_ID_MAX)}`;
}

/**
 * Count one request against `subject` and report the verdict.
 *
 * FAILS OPEN. If the limiter is unreachable the request is admitted, because the limiter
 * is cost control and abuse mitigation — not the authorization boundary. That boundary is
 * the publishable key plus its package/cert/platform binding (identity.ts) and the
 * attestation gate, neither of which this touches. Failing closed would convert a
 * limiter outage into a total product outage, which trades a bounded cost problem for an
 * unbounded availability one.
 *
 * The failure is logged with operation shape only — never the subject, which carries a
 * device_id.
 */
export async function consumeRateLimit(
  db: any,
  subject: string,
  limit: number,
  windowSeconds: number = WINDOW_SECONDS,
): Promise<RateVerdict> {
  try {
    const { data, error } = await db.rpc("consume_rate_limit", {
      p_subject: subject,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    // A RETURNS TABLE function comes back as an array through supabase-js.
    const row = Array.isArray(data) ? data[0] : data;

    if (error || !row) return failOpen(subject, limit, windowSeconds, "no_row");

    return {
      allowed: row.allowed === true,
      limit,
      remaining: typeof row.remaining === "number" ? row.remaining : 0,
      resetAt: String(row.reset_at),
    };
  } catch (e) {
    return failOpen(subject, limit, windowSeconds, e instanceof Error ? e.name : "throw");
  }
}

function failOpen(subject: string, limit: number, windowSeconds: number, reason: string): RateVerdict {
  // Subject prefix only ('key' / 'device'); the rest identifies a device.
  console.error(JSON.stringify({
    stage: "rate_limit_unavailable",
    subject_kind: subject.split(":")[0],
    reason,
  }));
  return {
    allowed: true,
    limit,
    remaining: limit,
    resetAt: new Date(Date.now() + windowSeconds * 1000).toISOString(),
  };
}
