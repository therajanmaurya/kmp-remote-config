/**
 * Stable percentage bucketing.
 *
 * Two rules, and both exist because violating them produces a bug that looks like a product
 * defect rather than a config one:
 *
 *  1. **The bucket is a pure function of (config, device).** Never a random draw. A per-fetch
 *     draw re-rolls on every poll, so a device enters and leaves the rollout continuously —
 *     reported as "the feature keeps flickering", and almost never traced back to a rollout.
 *
 *  2. **The percentage is NEVER part of the hash input.** It is only compared against the
 *     bucket afterwards. Mixing it in reshuffles the whole population when it changes, so
 *     raising 10% to 20% drops some of the original 10% while adding others. The totals still
 *     look right, which is what lets it through review.
 *
 * Together these make a raise purely additive and a lower purely subtractive, which is the
 * property an operator actually assumes when they move the slider.
 */

/**
 * FNV-1a, 32-bit. Chosen over `crypto.subtle` because that is async and would push an await
 * into the per-config filter loop; over `String.hashCode`-style sums because those clump
 * badly on structured input like UUIDs, and a clumping hash makes a 10% rollout reach 2% or
 * 40% while every stability property still holds.
 */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // The classic FNV prime, via shifts so the intermediate stays in 32-bit range.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** A device's position in 0..99 for one config. Stable forever for that pair. */
export function rolloutBucket(configId: string, deviceId: string): number {
  return fnv1a(`${configId}:${deviceId}`) % 100;
}

/**
 * Whether this device receives a config at the given percentage.
 *
 * A null device id is EXCLUDED from any partial rollout — an older SDK that sends no
 * `X-RC-Device`, or a host app that blocked it. Including them would silently turn a 10%
 * rollout into "10% plus everyone we cannot identify", which is unbounded. 100% still reaches
 * them, because 100% means everyone by definition.
 */
export function inRollout(configId: string, deviceId: string | null, percentage: number): boolean {
  if (percentage >= 100) return true;
  if (percentage <= 0) return false;
  if (!deviceId) return false;
  return rolloutBucket(configId, deviceId) < percentage;
}
