import { startGoogleSignIn } from "@/lib/sign-in"

/**
 * The sign-in button got stuck on "Redirecting to Google…" forever, with no error shown.
 *
 * Root cause: `createClient()` throws when the public Supabase env vars are missing from the
 * bundle, and the click handler had no try/catch — so the rejection escaped, `busy` was never
 * reset, and the one control on the page became permanently dead with nothing explaining why.
 *
 * The logic lives in a pure function precisely so this is testable without a DOM: the failure
 * is about CONTROL FLOW, not rendering, and a test that needed jsdom to prove it would have
 * been skipped.
 */

type Result = Awaited<ReturnType<typeof startGoogleSignIn>>

const ORIGIN = "https://rconfig.example.com"

test("a thrown client-construction error is returned, never propagated", async () => {
  // Exactly the production failure: @supabase/ssr throws when url/key are absent.
  const res: Result = await startGoogleSignIn(
    () => { throw new Error("Your project's URL and API key are required to create a Supabase client!") },
    ORIGIN,
  )
  expect(res.ok).toBe(false)
  // The message has to reach the operator. "Something went wrong" would leave them with the
  // same dead button and no lead.
  expect(res.error).toMatch(/URL and API key/)
})

test("a non-Error throw still produces a readable message", async () => {
  const res: Result = await startGoogleSignIn(() => { throw "boom" }, ORIGIN)
  expect(res.ok).toBe(false)
  expect(typeof res.error).toBe("string")
  expect(res.error!.length).toBeGreaterThan(0)
})

test("an OAuth error returned by supabase is surfaced", async () => {
  const res: Result = await startGoogleSignIn(
    () => ({ auth: { signInWithOAuth: async () => ({ error: { message: "provider disabled" } }) } }) as never,
    ORIGIN,
  )
  expect(res.ok).toBe(false)
  expect(res.error).toBe("provider disabled")
})

test("a successful start reports ok and asks for the callback on this origin", async () => {
  let seen: unknown = null
  const res: Result = await startGoogleSignIn(
    () => ({
      auth: {
        signInWithOAuth: async (opts: unknown) => { seen = opts; return { error: null } },
      },
    }) as never,
    ORIGIN,
  )
  expect(res.ok).toBe(true)
  expect(res.error).toBeUndefined()
  // The redirect must target THIS origin's callback — a hardcoded host would break every
  // preview deployment, and the PKCE exchange happens there.
  expect(seen).toMatchObject({
    provider: "google",
    options: { redirectTo: `${ORIGIN}/auth/callback` },
  })
})

test("a rejected signInWithOAuth promise is caught too", async () => {
  // A network failure mid-call must leave the button usable rather than stuck.
  const res: Result = await startGoogleSignIn(
    () => ({ auth: { signInWithOAuth: async () => { throw new Error("network down") } } }) as never,
    ORIGIN,
  )
  expect(res.ok).toBe(false)
  expect(res.error).toMatch(/network down/)
})
