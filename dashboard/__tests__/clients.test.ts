/**
 * The clients must read the anon key, never the service-role key. This is the cheapest
 * possible guard on the one mistake that would hand every tenant's data to every
 * signed-in user: an ssr client constructed with service_role bypasses RLS entirely, and
 * the dashboard would still look correct to whoever built it.
 */
describe("supabase clients", () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
    jest.resetModules()
  })

  it("server client is built from the anon key", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-value"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-value"

    const seen: string[] = []
    jest.doMock("@supabase/ssr", () => ({
      createServerClient: (_url: string, key: string) => {
        seen.push(key)
        return {}
      },
      createBrowserClient: (_url: string, key: string) => {
        seen.push(key)
        return {}
      },
    }))
    jest.doMock("next/headers", () => ({
      cookies: () => ({ getAll: () => [], set: () => {} }),
    }))

    const { createClient } = await import("@/lib/supabase-server")
    createClient()

    expect(seen).toEqual(["anon-test-value"])
    expect(seen).not.toContain("service-role-test-value")
  })

  it("browser client is built from the anon key too", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-value"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-value"

    const seen: string[] = []
    jest.doMock("@supabase/ssr", () => ({
      createServerClient: (_u: string, k: string) => { seen.push(k); return {} },
      createBrowserClient: (_u: string, k: string) => { seen.push(k); return {} },
    }))

    const { createClient } = await import("@/lib/supabase-browser")
    createClient()
    expect(seen).toEqual(["anon-test-value"])
  })
})
