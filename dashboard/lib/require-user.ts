import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase-server"

/**
 * Every page below the auth boundary calls this first.
 *
 * Returns the user AND the client together so a page never constructs a second client with
 * a different cookie view — which is how a page ends up rendering for a session the
 * middleware has since refreshed.
 *
 * ── Why `cache()` ───────────────────────────────────────────────────────────────────────────
 * `supabase.auth.getUser()` is deliberately the expensive call: unlike `getSession()`, which
 * decodes the JWT locally and trusts it, `getUser()` makes a real HTTP request to Supabase Auth
 * to validate the token. That is the right choice on a server — a locally-decoded JWT is only as
 * trustworthy as the cookie it came from — but it costs a full round trip from the Cloudflare
 * edge to Supabase, measured at ~0.6s.
 *
 * This function is called from 28 places, and a single view calls it more than once: the
 * `/apps/[id]` layout calls it, and so does the page rendered inside that layout. Uncached, that
 * is two independent clients making two independent validations of the same cookie, back to back,
 * before any data is fetched.
 *
 * React's `cache()` memoises per REQUEST (not across requests, and not across users — the cache
 * is scoped to the render pass), so the layout and the page now share one validation and one
 * client. That also strengthens the invariant in the paragraph above from a convention into a
 * guarantee: there is physically only one client per request to disagree with.
 *
 * It does NOT dedupe against the middleware's own `getUser()` — different runtime, separate
 * invocation — and that one must stay: it is what refreshes the session cookie, so removing it
 * would silently log people out when their token expired mid-session. One unavoidable hop per
 * navigation, not three.
 */
export const requireUser = cache(async () => {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")
  return { user, supabase }
})
