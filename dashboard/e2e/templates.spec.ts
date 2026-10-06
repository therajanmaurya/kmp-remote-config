import { expect, test } from "@playwright/test"
import { ids } from "./ids"

test("a built template is private, and authoring can use it", async ({ page }) => {
  await page.goto(`/apps/${ids.app_a_id}/templates/new`)
  await page.getByLabel("Name", { exact: true }).fill("Welcome card")
  await page.getByLabel("Description").fill("Shown once to new users")
  await page.getByRole("button", { name: "Save template" }).click()

  await expect(page).toHaveURL(new RegExp(`/apps/${ids.app_a_id}/templates$`))
  await expect(page.getByText("Welcome card")).toBeVisible()
  await expect(page.getByTestId("visibility")).toHaveText("private")

  // The payoff: it appears in the config authoring picker, marked custom.
  await page.goto(`/apps/${ids.app_a_id}/configs/new`)
  await expect(page.getByRole("button", { name: /Welcome card/i })).toBeVisible()
})

test("sharing is explicit, states its consequences, and records who and when", async ({ page }) => {
  await page.goto(`/apps/${ids.app_a_id}/templates`)
  await page.getByRole("button", { name: "Share" }).first().click()

  // The consent surface must say what sharing actually does.
  await expect(page.getByText(/visible to every other operator/i)).toBeVisible()
  await expect(page.getByText(/withdrawal does not retract copies/i)).toBeVisible()
  await page.getByLabel("Credit (optional)").fill("Acme Design")
  await page.getByRole("button", { name: "Share", exact: true }).last().click()

  await expect(page.getByTestId("visibility")).toHaveText("community")
  await expect(page.getByText(/shared \d{4}-\d{2}-\d{2} by Acme Design/)).toBeVisible()
})

test("a second user sees it in the catalog and adopts a COPY that is private", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/fixtures/user-b.json" })
  const page = await ctx.newPage()

  await page.goto("/community")
  await expect(page.getByText("Welcome card")).toBeVisible()
  await expect(page.getByText("by Acme Design")).toBeVisible()
  await page.getByRole("button", { name: /Add to my app/i }).first().click()

  // The copy lands private in B's app — adopting is not republishing.
  await expect(page).toHaveURL(new RegExp(`/apps/${ids.app_b_id}/templates$`))
  await expect(page.getByText("Welcome card")).toBeVisible()
  await expect(page.getByTestId("visibility")).toHaveText("private")
  await expect(page.getByText(/forked from c_/)).toBeVisible()
  await ctx.close()
})

test("withdrawing removes it from the catalog but not the copies already taken", async ({ page, browser }) => {
  await page.goto(`/apps/${ids.app_a_id}/templates`)
  await page.getByRole("button", { name: "Withdraw" }).first().click()
  await expect(page.getByTestId("visibility")).toHaveText("private")

  const ctx = await browser.newContext({ storageState: "e2e/fixtures/user-b.json" })
  const b = await ctx.newPage()
  await b.goto("/community")
  await expect(b.getByText("Welcome card")).toHaveCount(0)
  // B's forked copy still works — this is exactly why adoption copies rather than references.
  await b.goto(`/apps/${ids.app_b_id}/templates`)
  await expect(b.getByText("Welcome card")).toBeVisible()
  await ctx.close()
})
