"use server"

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/require-user"
import { normalizeInviteEmail } from "@/lib/invite-email"

export type InviteResult = { ok: true; email: string } | { ok: false; error: string }

/**
 * Invite someone to an app by email.
 *
 * There is no invite LINK and no token in a URL. Sign-in here is Google OAuth, which already
 * proves control of the address, so a mailed token would be a second and weaker credential —
 * forwardable, loggable by a mail scanner, replayable — establishing something the identity
 * provider has established already. The invitation sits in the database until someone signs in
 * with that address, and `/auth/callback` claims it.
 *
 * The practical consequence, which the UI states rather than hides: nothing is emailed. The
 * inviter tells the person to sign in. Adding delivery later changes nothing about the grant.
 */
export async function inviteMember(input: {
  appId: string
  email: string
  role: string
}): Promise<InviteResult> {
  const { user, supabase } = await requireUser()

  // Normalisation lives in lib/invite-email.ts, tested on its own: it is one half of a match
  // whose other half is in Postgres, and a disagreement between them fails silently — the
  // invitation is written, the person signs in, and nothing happens.
  const parsed = normalizeInviteEmail(input.email)
  if (!parsed.ok) return parsed
  const email = parsed.email
  if (!input.appId) return { ok: false, error: "Choose which app they should get access to." }
  if (!["owner", "editor", "viewer"].includes(input.role)) {
    return { ok: false, error: "Pick a role." }
  }
  if (email === user.email?.toLowerCase()) {
    return { ok: false, error: "That is your own address — you already have access." }
  }

  const { error } = await supabase
    .from("app_invitation")
    .insert({ app_id: input.appId, email, role: input.role, invited_by: user.id })

  if (error) {
    // 23505 is the partial unique index on (app_id, email) WHERE pending — someone already has
    // an open invitation to this app. Saying so is more useful than "duplicate key".
    if (error.code === "23505") {
      return { ok: false, error: `${email} already has a pending invitation to this app.` }
    }
    // 42501 is RLS: the policy admits owners only. Editors can change configs but cannot hand
    // that ability to anyone else.
    if (error.code === "42501") {
      return { ok: false, error: "Only an owner of that app can invite people to it." }
    }
    return { ok: false, error: error.message }
  }

  revalidatePath("/admin/members")
  return { ok: true, email }
}

export async function revokeInvitation(id: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireUser()

  // An UPDATE rather than a DELETE: the row is the record that an invitation was extended and
  // withdrawn. Deleting it would make a re-invite look like the first one, and leave nothing
  // behind if someone later asks who had been offered access.
  const { error } = await supabase
    .from("app_invitation")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("accepted_at", null)

  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/members")
  return { ok: true }
}
