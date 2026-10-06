export const runtime = "edge"

import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

/**
 * Expire every PKCE code-verifier cookie once the exchange has consumed it.
 *
 * `signInWithOAuth` writes `sb-<ref>-auth-token-flow-<hash>-code-verifier` plus an index
 * cookie, and `exchangeCodeForSession` spends it. In PayCraft nothing deleted them, so they
 * lingered with the token's ~400-day expiry — observed live on BOTH localhost and
 * production. A leftover verifier can be treated as current on the NEXT flow, and GoTrue
 * answers {"message":"Bad request"}.
 *
 * ALL of them, not just this flow's: abandoned attempts (cancelled at Google, a network
 * blip mid-exchange) leave their own, and they are equally spent. Clearing only on the
 * login page is not enough, because a flow begun anywhere else never lands there.
 */
function clearSpentPkceVerifiers(request: NextRequest, response: NextResponse) {
  for (const { name } of request.cookies.getAll()) {
    if (!name.startsWith("sb-") || !name.includes("code-verifier")) continue
    // maxAge 0 + a matching path is what actually removes it; `delete` alone can miss a
    // cookie whose attributes differ from the framework's default.
    response.cookies.set({ name, value: "", path: "/", maxAge: 0 })
  }
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const origin = requestUrl.origin

  if (!code) return NextResponse.redirect(new URL("/auth/login", origin))

  // Create the redirect FIRST so auth cookies land on this exact response object — a
  // separate cookie store does not transfer onto a redirect, and the symptom is a
  // successful exchange followed by a signed-out dashboard.
  const response = NextResponse.redirect(new URL("/", origin))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set({ name, value, ...options })
          })
        },
      },
    },
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    const failed = NextResponse.redirect(
      new URL(`/auth/login?error=${encodeURIComponent(error.message)}`, origin),
    )
    clearSpentPkceVerifiers(request, failed)
    return failed
  }

  clearSpentPkceVerifiers(request, response)
  return response
}
