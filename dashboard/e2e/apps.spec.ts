import { expect, test } from "@playwright/test"
import { ids } from "./ids"

/**
 * AC1 + AC2 + AC3. The isolation assertion is the point: AC3 says a second user "sees
 * neither — proven by the §13.1 negative tests, not by inspection". Those SQL tests prove
 * the POLICY; this proves the dashboard actually RELIES on it rather than filtering in the
 * page, which would hide an RLS regression.
 */
test("the app list shows the signed-in user's app", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("E2E App A")).toBeVisible()
})

test("creating an app lands on its overview and shows the derived slug", async ({ page }) => {
  await page.goto("/apps/new")
  await page.getByLabel("Name").fill("Alpha Reader!")
  // The slug is shown before saving, because it ends up in key prefixes.
  await expect(page.getByText("alpha-reader")).toBeVisible()
  await page.getByLabel("android").check()
  await page.getByRole("button", { name: "Create app" }).click()
  await expect(page).toHaveURL(/\/apps\/[0-9a-f-]{36}$/)
  await expect(page.getByRole("heading", { name: "Alpha Reader!" })).toBeVisible()
})

test("a name with nothing usable is refused with a reason", async ({ page }) => {
  await page.goto("/apps/new")
  await page.getByLabel("Name").fill("!!!")
  await page.getByLabel("android").check()
  await page.getByRole("button", { name: "Create app" }).click()
  await expect(page.locator("p[role=alert]")).toContainText(/no letters or digits/i)
})

test("a second user sees neither app, and cannot open one by id", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/fixtures/user-b.json" })
  const page = await ctx.newPage()

  await page.goto("/")
  await expect(page.getByText("E2E App B")).toBeVisible()
  await expect(page.getByText("E2E App A")).toHaveCount(0)
  await expect(page.getByText("Alpha Reader!")).toHaveCount(0)

  // Direct navigation by id — the URL is guessable, the data must not be.
  await page.goto(`/apps/${ids.app_a_id}`)
  await expect(page.getByText("E2E App A")).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible()
  await ctx.close()
})

test("an anonymous visitor is redirected to sign in", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await ctx.newPage()
  await page.goto("/")
  await expect(page).toHaveURL(/\/auth\/login$/)
  await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible()
  await ctx.close()
})

test("the overview counts are real numbers, not placeholders", async ({ page }) => {
  // A `·` placeholder shipped here in the first draft. The framework's design-conformance
  // rule objects to exactly that: a card that looks like data and is not.
  await page.goto(`/apps/${ids.app_a_id}`)
  for (const label of ["active configs", "live keys", "custom templates"]) {
    const card = page.locator("a", { has: page.getByText(label, { exact: true }) })
    await expect(card).toBeVisible()
    await expect(card.locator("p").first()).toHaveText(/^\d+$/)
  }
})
