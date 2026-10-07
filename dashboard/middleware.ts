import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Session refresh ONLY.
 *
 * PayCraft's middleware also carries API_HOSTS / MCP_HOSTS rewrites and an edge rate
 * limiter. Those solve PayCraft's problems — a separate api.* hostname and an MCP
 * endpoint — neither of which exists here, and copying them would ship dead hostname
 * branches. Rate limiting for this product lives in the Edge Functions against a shared
 * Postgres bucket (migration 008), not at this layer.
 */
export async function middleware(request: NextRequest) {
  // A server component cannot read its own pathname, and the app layout needs it to highlight
  // the current sidebar entry. Stamping it here is the supported way to get it there.
  request.headers.set("x-pathname", request.nextUrl.pathname)
  let response = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Refreshes the access token and writes new cookies when it has expired. Without this
  // every page eventually renders as signed-out mid-session.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
