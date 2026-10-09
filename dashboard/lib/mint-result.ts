/**
 * Make sense of whatever a server action hands back — including nothing at all.
 *
 * A client component that does `if (!r.ok)` on an action's result is one `undefined` away from
 * failing silently: the TypeError lands inside an async handler, React reports an unhandled
 * rejection to the console, and the screen does not change. That is precisely what happened to
 * the Generate-token button, and it is why the real cause (an action revalidating the route its
 * caller lives in) took a debugging session to find instead of being named on screen.
 *
 * So the rule this encodes is: the UI always says something. A result it cannot interpret is an
 * error with a message a person can act on, never an exception and never a blank.
 */

export type MintPayload = { ok: true; token: string; name: string } | { ok: false; error: string }

export type Interpreted =
  | { kind: "minted"; token: string; name: string }
  | { kind: "error"; message: string }

const UNREACHABLE =
  "The result did not come back from the server. The token may still have been created — " +
  "reload this page before trying again, so you do not end up with two."

export function interpretMintResult(result: unknown): Interpreted {
  // The production symptom. Note the message does NOT claim nothing happened: the action may
  // well have succeeded and lost its reply, and telling someone to retry blindly is how an
  // account collects duplicate credentials nobody can account for.
  if (result == null || typeof result !== "object") {
    return { kind: "error", message: UNREACHABLE }
  }

  const r = result as Partial<MintPayload> & Record<string, unknown>

  if (r.ok === true) {
    const token = typeof r.token === "string" ? r.token.trim() : ""
    if (!token) {
      return {
        kind: "error",
        message:
          "The server reported success but returned no token. It is shown only once, so this " +
          "one cannot be recovered — check the list below and revoke anything you cannot identify.",
      }
    }
    return { kind: "minted", token, name: typeof r.name === "string" && r.name ? r.name : "your token" }
  }

  if (r.ok === false) {
    const message = typeof r.error === "string" ? r.error.trim() : ""
    // A refusal with no reason still has to render as something readable.
    return { kind: "error", message: message || "The server refused the request but gave no reason." }
  }

  return { kind: "error", message: UNREACHABLE }
}
