import { expect, test } from "@playwright/test"

/**
 * Runs against the REAL deployment, so it is deliberately tiny: the full walkthroughs run
 * against a local stack. What only production can prove is that the edge build boots, the
 * secrets arrived, and auth redirects correctly.
 *
 * Opt-in — it ignores the shared baseURL and storageState, so `npx playwright test` against
 * localhost does not accidentally probe production. Run it explicitly:
 *   RCONFIG_SMOKE=1 npx playwright test e2e/smoke.spec.ts
 */
const BASE = process.env.RCONFIG_SMOKE_URL ?? "https://rconfig.mobilebytesensei.com"

test.describe("production smoke", () => {
  test.skip(!process.env.RCONFIG_SMOKE, "set RCONFIG_SMOKE=1 to probe the live deployment")
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
})
