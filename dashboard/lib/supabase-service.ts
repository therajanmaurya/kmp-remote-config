import { createClient as createSupabaseClient } from "@supabase/supabase-js"

/**
 * The ONLY service-role client. It bypasses RLS completely, so it is never imported into a
 * client component and never reachable from the browser.
 *
 * Throws rather than falling back to the anon key when the variable is absent: a silent
 * downgrade turns "this query bypasses RLS" into "this query returns nothing", and the
 * caller reads an empty result as "no rows" instead of "misconfigured". The message names
 * no variable — see __tests__/runtime-leak.test.ts.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!key || !url) throw new Error("service client is not configured")
  return createSupabaseClient(url, key, { auth: { persistSession: false } })
}
