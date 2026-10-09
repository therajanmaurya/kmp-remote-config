"use server"

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/require-user"

export type MintResult =
  | { ok: true; token: string; name: string }
  | { ok: false; error: string }

/**
 * Mint an access token and return the plaintext — the ONE time it is ever available.
 *
 * There is deliberately no "reveal" action to pair with this. The database stores only a
 * SHA-256 hash, so a token the dashboard could re-display would be a token stored in a form
 * the database could leak. If it is lost, it is replaced.
 */
export async function mintToken(input: {
  name: string
  expiresInDays: number | null
  appIds: string[] | null
  permissions: string[]
}): Promise<MintResult> {
  const { user, supabase } = await requireUser()

  const name = input.name.trim()
  if (!name) return { ok: false, error: "Give the token a name — it is how you tell them apart later." }
  if (input.permissions.length === 0) {
    return { ok: false, error: "Grant at least one permission, or the token can do nothing." }
  }

  const { data, error } = await supabase.rpc("access_token_create", {
    p_user_id: user.id,
    p_name: name,
    p_expires_in_days: input.expiresInDays,
    p_app_ids: input.appIds,
    p_permissions: input.permissions,
  })

  if (error) {
    // Translate rather than surface. A caller reading "42501" learns nothing actionable.
    if (error.code === "42501") {
      return { ok: false, error: "You can only scope a token to apps you are a member of." }
    }
    return { ok: false, error: error.message }
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.token) return { ok: false, error: "The token was not returned. Nothing was created." }

  // NO revalidatePath here, and this is the whole bug.
  //
  // Revalidating the route a client component is mounted in remounts that tree, so the client's
  // `await` resolves into a component that no longer exists and the result arrives as
  // `undefined`. The token WAS created; the reply was thrown away. On screen that reads as
  // "the button does nothing", which is the hardest possible symptom to act on.
  //
  // `app/onboarding/actions.ts` carries the same comment from the same bug found earlier in this
  // project. A comment was evidently not enough to stop it recurring, so `__tests__/mint-token.test.ts`
  // now asserts it structurally.
  //
  // The list does not need revalidating anyway: the minted token is rendered from client state
  // (it is shown exactly once and never re-read from the server), and the row appears on the
  // next navigation or reload.
  return { ok: true, token: String(row.token), name }
}

export async function revokeToken(id: string): Promise<{ ok: boolean; error?: string }> {
  const { user, supabase } = await requireUser()
  const { error } = await supabase.rpc("access_token_revoke", { p_id: id, p_user_id: user.id })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/account/tokens")
  return { ok: true }
}
