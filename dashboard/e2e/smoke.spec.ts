import { expect, test } from "@playwright/test"

/**
 * Runs against the REAL deployment, so it is deliberately tiny: the full walkthroughs run
 * against a local stack. What only production can prove is that the edge build boots, the
 * secrets arrived, and auth redirects correctly.
 *
 * This is the DEFAULT suite: `npx playwright test` with no flags probes production and runs
 * nothing that needs a local stack. Point it elsewhere with RCONFIG_SMOKE_URL.
 * The signed-in walkthroughs need RCONFIG_LOCAL_E2E=1 and a running local stack.
 */
const BASE = process.env.RCONFIG_SMOKE_URL ?? "https://rconfig.mobilebytesensei.com"

test.describe("production smoke", () => {
  test.use({ storageState: { cookies: [], origins: [] }, baseURL: BASE })

  test("health reports fully configured", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`)
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ ok: true, missing_count: 0 })
  })

  test("an anonymous visitor is sent to sign in", async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(page).toHaveURL(/\/auth\/login$/)
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible()
  })

  test("no shipped chunk contains service-role material", async ({ page }) => {
    // The last line of defence behind Task 2's map test: assert on what ACTUALLY shipped.
    // A NEXT_PUBLIC_ twin added later would be inlined into these chunks, and no unit test
    // can see the built output.
    const bodies: string[] = []
    page.on("response", async (r) => {
      if (r.url().endsWith(".js")) bodies.push(await r.text().catch(() => ""))
    })
    await page.goto(`${BASE}/auth/login`)
    await page.waitForLoadState("networkidle")

    expect(bodies.length).toBeGreaterThan(0) // an empty scan proves nothing
    const all = bodies.join("\n")
    expect(all).not.toMatch(/"role"\s*:\s*"service_role"/)
    // A service-role JWT carries base64("service_role") in its payload segment. The anon
    // key is EXPECTED here and must not be mistaken for a finding.
    expect(all).not.toMatch(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl/)
  })

  /**
   * The bug this pins (reported 2026-10-06, "google login is not working properly"):
   * Supabase had an EMPTY uri_allow_list and site_url = http://localhost:3000. GoTrue
   * rejects a redirect_to that is not allowlisted and falls back to site_url — so sign-in
   * succeeded at Google and then dumped the operator on a dead localhost page.
   *
   * Asserted end-to-end without credentials: clicking through must reach Google's real
   * consent screen, carry the Supabase callback as redirect_uri, carry PRODUCTION as the
   * post-auth redirect_to, and report no error. Entering credentials is the one step that
   * stays with a human.
   */
  test("the Google sign-in redirect chain is configured for production", async ({ page }) => {
    await page.goto(`${BASE}/auth/login`)
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => null),
      page.getByRole("button", { name: /Continue with Google/i }).click(),
    ])

    const u = new URL(page.url())
    expect(u.host, "sign-in must reach Google, not bounce back with an error").toBe("accounts.google.com")
    expect(u.searchParams.get("error")).toBeNull()
    expect(u.searchParams.get("redirect_uri")).toContain(".supabase.co/auth/v1/callback")

    // The whole bug in one assertion: the post-auth hop must be production, never localhost.
    const opparams = decodeURIComponent(decodeURIComponent(u.searchParams.get("opparams") ?? ""))
    expect(opparams, "redirect_to must be the production callback").toContain(
      "rconfig.mobilebytesensei.com/auth/callback",
    )
    expect(opparams).not.toContain("localhost")
  })

  test("the callback clears a stale PKCE verifier instead of failing closed", async ({ request }) => {
    // A spent verifier poisons the NEXT attempt, which is how "login worked once then
    // stopped" happens. The route must expire it even on a failed exchange.
    const res = await request.get(`${BASE}/auth/callback?code=bogus-code-xyz`, {
      headers: { Cookie: "sb-test-auth-token-flow-abc-code-verifier=stale" },
      maxRedirects: 0,
    })
    expect(res.status()).toBe(307)
    expect(res.headers()["location"]).toContain("/auth/login?error=")
    const sc = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value).join("\n")
    expect(sc).toMatch(/code-verifier=;[\s\S]*?Max-Age=0/)
  })
})
