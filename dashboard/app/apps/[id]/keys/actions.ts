"use server"

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/require-user"

/**
 * AC4: issuing produces a live key AND a test key in one action.
 *
 * Both together because a developer handed only a live key will use it in debug builds,
 * and Play Integrity rejects sideloaded and debug builds (§7.3) — so the live key looks
 * broken on the only build they can run locally. The test key exists for exactly that
 * case, which is why it ships with attestation_policy 'off'.
 */
export async function issueKeyPair(appId: string, label: string | null) {
  const { supabase } = await requireUser()

  const rows: Array<Record<string, unknown>> = []
  for (const environment of ["live", "test"] as const) {
    // The key is minted by the database function, not here: it owns the rejection-sampled
    // alphabet and the rck_ prefix, and app_key_prefix_matches_env would reject anything
    // built differently.
    const { data: key, error: genError } = await supabase.rpc("generate_publishable_key", {
      p_env: environment,
    })
    if (genError || !key) return { error: "Could not generate a key." }

    rows.push({
      app_id: appId,
      key,
      label,
      environment,
      // 'off' on the test key is deliberate (see above). The live key keeps the schema
      // default 'preferred' — NOT 'required', because no attestation verifier exists yet
      // and 'required' would reject all traffic (§7.3, and DEPLOY.md's standing caveat).
      attestation_policy: environment === "test" ? "off" : "preferred",
    })
  }

  const { error } = await supabase.from("app_key").insert(rows)
  if (error) return { error: "Could not save the keys." }

  revalidatePath(`/apps/${appId}/keys`)
  return { ok: true }
}

export async function revokeKey(keyId: string, appId: string) {
  const { supabase } = await requireUser()

  // An UPDATE, not a DELETE: the key string is what appears in SDK logs and support
  // threads, and deleting it makes "which key was this?" unanswerable.
  const { error } = await supabase
    .from("app_key")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("app_id", appId) // belt and braces over the policy

  if (error) return { error: "Could not revoke the key." }
  revalidatePath(`/apps/${appId}/keys`)
  return { ok: true }
}
