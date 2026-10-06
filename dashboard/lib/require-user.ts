import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase-server"

/**
 * Every page below the auth boundary calls this first.
 *
 * Returns the user AND the client together so a page never constructs a second client with
 * a different cookie view — which is how a page ends up rendering for a session the
 * middleware has since refreshed.
 */
export async function requireUser() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")
  return { user, supabase }
}
