/**
 * Renders the failure and asserts on the bytes.
 *
 * A source scan is not enough, and PayCraft proved it: a scan sees the literal
 * "SUPABASE_SERVICE_ROLE_KEY is not set" but is blind to a message ASSEMBLED at runtime
 * from a value the code never names. The same blindness covered a live leak there — five
 * endpoints passed Postgres error.message to the caller, and a Postgres message carries
 * constraint names and ROW VALUES.
 */
const FORBIDDEN =
  /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE|SERVICE_ROLE_KEY|postgres(ql)?:\/\/|eyJ[A-Za-z0-9_-]{20}/

describe("/api/health", () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
    jest.resetModules()
  })

  it("reports a count when variables are missing, and names none of them", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    jest.resetModules()

    const mod = await import("@/app/api/health/route")
    const text = await (await mod.GET()).text()

    expect(text).not.toMatch(FORBIDDEN)
    expect(text).toMatch(/missing_count/) // silence would be its own bug
  })

  it("reports ok when everything is present, still naming nothing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc"
    jest.resetModules()

    const mod = await import("@/app/api/health/route")
    const res = await mod.GET()
    const text = await res.text()

    expect(JSON.parse(text)).toEqual({ ok: true, missing_count: 0 })
    expect(text).not.toMatch(FORBIDDEN)
  })

  it("the service client refuses rather than downgrading, and names nothing", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    jest.resetModules()

    const { createServiceClient } = await import("@/lib/supabase-service")
    expect(() => createServiceClient()).toThrow(/not configured/)
    try {
      createServiceClient()
    } catch (e) {
      expect(String((e as Error).message)).not.toMatch(FORBIDDEN)
    }
  })
})
