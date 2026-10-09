import { readFileSync } from "node:fs"
import { join } from "node:path"
import { interpretMintResult } from "@/lib/mint-result"

/**
 * Why the Generate-token button did nothing.
 *
 * The operator filled the form, clicked Generate, and got no token AND no error — the screen
 * simply did not change. Two defects stacked, and the second is what made the first invisible.
 *
 * ── Defect 1: the action revalidated the path it was called from ──────────────────────────
 * `mintToken` ended with `revalidatePath("/account/tokens")` before returning. Revalidating the
 * route a client component is mounted in remounts that tree, so the client's `await` resolves
 * into a component that no longer exists and the result arrives as `undefined`.
 *
 * This is not a new discovery. The same bug was found and fixed in `app/onboarding/actions.ts`
 * earlier in this project, and that file carries a comment explaining it. The token action
 * repeated it anyway — which is exactly why this is now a TEST and not a comment.
 *
 * ── Defect 2: the client assumed the result was well-formed ───────────────────────────────
 * `submit()` did `if (!r.ok)` on whatever came back. With `r === undefined` that throws a
 * TypeError inside an async handler: an unhandled rejection, no state change, no message. A
 * silent failure is worse than a loud one — it cost a debugging session to find a bug the UI
 * could have named instantly.
 */

const ACTIONS = join(process.cwd(), "app/account/tokens/actions.ts")

describe("the mint action", () => {
  // Matches an invocation, not the word. The first version of this test used /revalidatePath/
  // and went red against the comment EXPLAINING why the call was removed — a scan that cannot
  // tell discussion from invocation fails the moment someone documents the fix.
  const CALL = /(?<!\/\/.*)\brevalidatePath\s*\(/

  /** The function body with comment lines stripped, so prose can never satisfy or break a check. */
  const bodyOf = (src: string, from: string, to?: string) =>
    src
      .slice(src.indexOf(from), to ? src.indexOf(to) : undefined)
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n")

  it("does not revalidate the path it was called from", () => {
    // Structural, because the failure is structural: revalidating a route the calling component
    // lives in destroys that component before it can read the result. The token is created
    // either way, which is exactly what makes this invisible from the UI.
    const src = readFileSync(ACTIONS, "utf8")
    expect(bodyOf(src, "export async function mintToken", "export async function revokeToken"))
      .not.toMatch(CALL)
  })

  it("still revalidates on revoke, where the caller reloads anyway", () => {
    // Revoke may revalidate: its caller does a full reload rather than reading a return value,
    // so a remount costs nothing. Asserting this keeps the fix from being over-applied into
    // "never revalidate anywhere", which would just leave the list stale instead.
    const src = readFileSync(ACTIONS, "utf8")
    expect(bodyOf(src, "export async function revokeToken")).toMatch(CALL)
  })
})

describe("interpretMintResult", () => {
  it("surfaces a minted token", () => {
    expect(interpretMintResult({ ok: true, token: "rcp_abc", name: "ci" }))
      .toEqual({ kind: "minted", token: "rcp_abc", name: "ci" })
  })

  it("surfaces a refusal the server explained", () => {
    expect(interpretMintResult({ ok: false, error: "Give the token a name." }))
      .toEqual({ kind: "error", message: "Give the token a name." })
  })

  it("explains an UNDEFINED result instead of throwing", () => {
    // The actual production symptom. `r.ok` on undefined throws inside an async handler, which
    // React swallows as an unhandled rejection: no token, no error, no clue.
    const r = interpretMintResult(undefined)
    expect(r.kind).toBe("error")
    expect(r.kind === "error" && r.message).toMatch(/did not come back/i)
  })

  it("explains a null result", () => {
    expect(interpretMintResult(null).kind).toBe("error")
  })

  it("explains a success that carries no token", () => {
    // ok:true with no token would otherwise render an empty copy box the operator cannot use
    // and cannot get back — the token is shown exactly once.
    const r = interpretMintResult({ ok: true, name: "ci" } as never)
    expect(r.kind).toBe("error")
    expect(r.kind === "error" && r.message).toMatch(/no token/i)
  })

  it("explains a failure that carries no message", () => {
    const r = interpretMintResult({ ok: false } as never)
    expect(r.kind).toBe("error")
    expect(r.kind === "error" && r.message.length).toBeGreaterThan(0)
  })

  it("never returns an error with an empty message", () => {
    // An empty string renders as a blank red line — visually identical to the silent failure
    // this whole exercise was about.
    for (const bad of [undefined, null, {}, { ok: false }, { ok: true }, "nonsense", 42]) {
      const r = interpretMintResult(bad as never)
      if (r.kind === "error") expect(r.message.trim().length).toBeGreaterThan(0)
    }
  })
})
