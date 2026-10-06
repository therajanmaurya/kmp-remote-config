import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

/**
 * Anon key + the caller's session cookie. Every query through this client is evaluated by
 * the RLS policies slice 1 proved with negative tests, so the dashboard holds no privilege
 * of its own and a bug here cannot cross tenants.
 */
export function createClient() {
  const cookieStore = cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component — cookies are read-only here. The middleware refresh keeps
            // the session current; this is not an error.
          }
        },
      },
    }
  )
}
