/**
 * Starting an OAuth sign-in, as a pure function.
 *
 * Extracted from the login component because the bug it fixes was about CONTROL FLOW, not
 * rendering: `createClient()` throws when the public Supabase env vars are missing from the
 * bundle, the click handler had no try/catch, and the rejection escaped — leaving the button
 * disabled on "Redirecting to Google…" forever with nothing on screen explaining why. The one
 * control on the page became permanently dead.
 *
 * Taking the client FACTORY as a parameter is what makes that testable in a node environment
 * with no DOM. A test that needed jsdom to prove this would not have been written.
 */

export type SignInResult = { ok: boolean; error?: string }

type OAuthClient = {
  auth: {
    signInWithOAuth: (opts: {
      provider: "google"
      options: { redirectTo: string }
    }) => Promise<{ error: { message: string } | null }>
  }
}

/** Anything can be thrown in JS; render something a human can act on regardless. */
function describe(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  if (typeof e === "string" && e.length > 0) return e
  return "Sign-in failed to start. Check the browser console for details."
}

export async function startGoogleSignIn(
  createClient: () => OAuthClient,
  origin: string,
): Promise<SignInResult> {
  try {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // THIS origin, never a hardcoded host: the PKCE exchange happens at the callback, and a
      // fixed host would break every preview deployment.
      options: { redirectTo: `${origin}/auth/callback` },
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    // Covers both the missing-config throw and a network failure mid-call. Either way the
    // caller gets a result it can render, and the button becomes usable again.
    return { ok: false, error: describe(e) }
  }
}
