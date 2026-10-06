/**
 * Pins both hard-won fixes carried over from PayCraft. Neither is visible in a happy-path
 * click-through: the cookie-target bug shows up as a mysterious signed-out state, and the
 * verifier leak only bites on a LATER sign-in attempt.
 */
import { NextRequest } from "next/server"

function reqWithCookies(url: string, cookies: Record<string, string>) {
  const r = new NextRequest(url)
  for (const [name, value] of Object.entries(cookies)) r.cookies.set(name, value)
  return r
}

describe("/auth/callback", () => {
  afterEach(() => jest.resetModules())

  it("expires every spent code-verifier cookie after a successful exchange", async () => {
    jest.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: {
          exchangeCodeForSession: async () => ({ error: null }),
          getUser: async () => ({ data: { user: { id: "u1" } } }),
        },
      }),
    }))

    const { GET } = await import("@/app/auth/callback/route")
    const res = await GET(
      reqWithCookies("https://rconfig.test/auth/callback?code=abc", {
        "sb-abc-auth-token-flow-deadbeef-code-verifier": "spent",
        "sb-abc-auth-token-flows-code-verifier": "index",
        "unrelated-cookie": "keep",
      }),
    )

    const setCookie = res.headers.getSetCookie().join("\n")
    // Both verifier cookies expired — the per-flow one AND the index.
    expect(setCookie).toMatch(/sb-abc-auth-token-flow-deadbeef-code-verifier=;[\s\S]*?Max-Age=0/)
    expect(setCookie).toMatch(/sb-abc-auth-token-flows-code-verifier=;[\s\S]*?Max-Age=0/)
    // ...and nothing unrelated touched.
    expect(setCookie).not.toMatch(/unrelated-cookie=;/)
  })

  it("clears the verifier on a FAILED exchange too, and returns to login", async () => {
    // The stale value a failure leaves behind is exactly what poisons the retry the user is
    // about to make, so the failure path must clear it as well.
    jest.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: { exchangeCodeForSession: async () => ({ error: { message: "bad grant" } }) },
      }),
    }))

    const { GET } = await import("@/app/auth/callback/route")
    const res = await GET(
      reqWithCookies("https://rconfig.test/auth/callback?code=abc", {
        "sb-abc-auth-token-flow-x-code-verifier": "spent",
      }),
    )

    expect(res.headers.get("location")).toContain("/auth/login?error=")
    expect(res.headers.getSetCookie().join("\n")).toMatch(/code-verifier=;[\s\S]*?Max-Age=0/)
  })

  it("redirects to login when no code is present", async () => {
    jest.doMock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: {} }) }))
    const { GET } = await import("@/app/auth/callback/route")
    const res = await GET(new NextRequest("https://rconfig.test/auth/callback"))
    expect(res.headers.get("location")).toContain("/auth/login")
  })

  it("on success it lands on the app list, not an onboarding route", async () => {
    // Unlike PayCraft's, this callback does not branch to /onboarding: `/` IS the app list
    // and its empty state is the onboarding (spec AC1, "lands on an empty app list").
    jest.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: {
          exchangeCodeForSession: async () => ({ error: null }),
          getUser: async () => ({ data: { user: { id: "u1" } } }),
        },
      }),
    }))
    const { GET } = await import("@/app/auth/callback/route")
    const res = await GET(new NextRequest("https://rconfig.test/auth/callback?code=abc"))
    expect(new URL(res.headers.get("location")!).pathname).toBe("/")
  })
})
