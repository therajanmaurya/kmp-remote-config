"use server"

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/require-user"

/**
 * Publishing and rollback both go through the SQL routines rather than writing
 * `config_version` from here. The table has no write policy and an append-only trigger: the
 * routines are the only sanctioned way in, and they carry the membership check and the row
 * lock that stops two concurrent publishes colliding on a version number.
 */
export async function publishApp(appId: string) {
  const { supabase } = await requireUser()
  const { data, error } = await supabase.rpc("publish", { p_app: appId })
  if (error) return { error: error.message }
  revalidatePath(`/apps/${appId}`, "layout")
  return { version: data as number }
}

export async function rollbackApp(appId: string, version: number) {
  const { supabase } = await requireUser()
  const { data, error } = await supabase.rpc("rollback_to", { p_app: appId, p_version: version })
  if (error) return { error: error.message }
  revalidatePath(`/apps/${appId}`, "layout")
  return { version: data as number }
}
