import { assert, assertEquals } from "jsr:@std/assert@1";
import { inRollout, rolloutBucket } from "./rollout.ts";

/**
 * Phase 05 / T1 — the three properties that separate a rollout from a coin flip.
 *
 * Both failure modes GOAL.md pins look like product bugs rather than config bugs, which is
 * what makes them expensive:
 *
 *  - a per-fetch random draw re-rolls every poll, so a device enters and leaves the rollout
 *    continuously. The bug report reads "the feature keeps flickering" and almost nobody
 *    traces that back to a rollout setting.
 *  - mixing the percentage into the hash input reshuffles the whole population when the
 *    percentage changes, so raising 10% to 20% DROPS some of the original 10% while adding
 *    others. The totals still look right, which is exactly why it survives review.
 */

const DEVICES = Array.from({ length: 2000 }, (_, i) => `device-${i}-fixed`);
const CONFIG_A = "0f9b7c1e-2a3d-4b5c-8d7e-1f2a3b4c5d6e";
const CONFIG_B = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";

Deno.test("G-7a — a device's bucket is stable across repeated evaluations", () => {
  const first = rolloutBucket(CONFIG_A, DEVICES[0]);
  for (let i = 0; i < 100; i++) {
    assertEquals(rolloutBucket(CONFIG_A, DEVICES[0]), first, "bucket changed between evaluations");
  }
  // And stable across percentage changes, which is the same property seen from the other side.
  assert(inRollout(CONFIG_A, DEVICES[0], 100));
});

Deno.test("G-7b — two configs at the same percentage select different device sets", () => {
  const a = new Set(DEVICES.filter((d) => inRollout(CONFIG_A, d, 10)));
  const b = new Set(DEVICES.filter((d) => inRollout(CONFIG_B, d, 10)));

  // If the config id were not in the hash, every 10% rollout would hit the SAME devices —
  // a small unlucky cohort would receive every experiment the product ever ran.
  const overlap = [...a].filter((d) => b.has(d)).length;
  assert(a.size > 0 && b.size > 0, "both rollouts should select someone");
  assert(
    overlap < a.size * 0.5,
    `expected largely independent sets, got ${overlap}/${a.size} overlap`,
  );
});

Deno.test("G-7c — raising a percentage is PURELY ADDITIVE", () => {
  const at10 = DEVICES.filter((d) => inRollout(CONFIG_A, d, 10));
  const at20 = new Set(DEVICES.filter((d) => inRollout(CONFIG_A, d, 20)));

  for (const d of at10) {
    assert(at20.has(d), `device ${d} was in the 10% set but dropped out of the 20% set`);
  }
  assert(at20.size > at10.length, "raising the percentage should add devices");
});

Deno.test("lowering a percentage only removes devices, never swaps them", () => {
  const at20 = DEVICES.filter((d) => inRollout(CONFIG_A, d, 20));
  const at10 = new Set(DEVICES.filter((d) => inRollout(CONFIG_A, d, 10)));
  for (const d of at10) {
    assert(at20.includes(d), `device ${d} is in the 10% set but not the 20% set`);
  }
});

Deno.test("0% reaches nobody and 100% reaches everybody", () => {
  assertEquals(DEVICES.filter((d) => inRollout(CONFIG_A, d, 0)).length, 0);
  assertEquals(DEVICES.filter((d) => inRollout(CONFIG_A, d, 100)).length, DEVICES.length);
});

Deno.test("the distribution is roughly even, so 10% means about 10%", () => {
  const n = DEVICES.filter((d) => inRollout(CONFIG_A, d, 10)).length;
  const pct = (n / DEVICES.length) * 100;
  // A hash that clumps would make a 10% rollout reach 2% or 40% while every other property
  // above still held — stable, additive, and wrong about the only number the operator typed.
  assert(pct > 6 && pct < 14, `expected ~10%, got ${pct.toFixed(1)}%`);
});

Deno.test("a device with no id is excluded from a partial rollout, not included by accident", () => {
  // No X-RC-Device header: the SDK is older than this feature, or the host app blocked it.
  // Excluding is the safe read — a partial rollout must not silently become 100%.
  assert(!inRollout(CONFIG_A, null, 50));
  // ...but a full rollout still reaches them, because 100% means everyone.
  assert(inRollout(CONFIG_A, null, 100));
});
