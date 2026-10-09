export const runtime = "edge"

import { requireUser } from "@/lib/require-user"
import { loadAppList } from "@/lib/fleet"
import { Shell } from "@/components/Shell"
import { AccessTokens, type TokenRow } from "@/components/AccessTokens"

/**
 * Account-level access tokens — the SECRET half of the two credential types.
 *
 * Lives under /account rather than /admin because it is per-USER, not per-account: these are
 * your tokens, acting as you. Another member of the same apps has their own list and cannot
 * see this one (RLS scopes the table to auth.uid()).
 */
export default async function AccessTokensPage() {
  const { user, supabase } = await requireUser()

  const [{ data: tokens }, apps] = await Promise.all([
    supabase
      .from("access_token")
      // token_hash is deliberately NOT selected. It is useless to the page and there is no
      // reason for a hash of a live credential to travel to a browser.
      .select("id, name, token_prefix, permissions, scoped, expires_at, last_used_at, created_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    loadAppList(supabase),
  ])

  return (
    <Shell active="Access Tokens" userEmail={user.email ?? null} apps={apps}>
      <AccessTokens tokens={(tokens ?? []) as TokenRow[]} apps={apps} />
    </Shell>
  )
}
