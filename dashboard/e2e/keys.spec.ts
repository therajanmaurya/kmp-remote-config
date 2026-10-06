import { expect, test } from "@playwright/test"
import { ids } from "./ids"

test("issuing produces a live and a test key, and only the test key skips attestation", async ({ page }) => {
  await page.goto(`/apps/${ids.app_a_id}/keys`)
  await page.getByTestId("issue-key").click()

  // AC4, both halves.
  await expect(page.getByText(/^rck_live_/)).toBeVisible()
  await expect(page.getByText(/^rck_test_/)).toBeVisible()

  const testRow = page.locator("tbody tr", { has: page.getByText(/^rck_test_/) })
  await expect(testRow.getByText("off")).toBeVisible()
  const liveRow = page.locator("tbody tr", { has: page.getByText(/^rck_live_/) })
  await expect(liveRow.getByText("preferred")).toBeVisible()
})

test("a revoked key stays listed and reads as revoked, never as live", async ({ page }) => {
  await page.goto(`/apps/${ids.app_a_id}/keys`)
  const liveRow = page.locator("tbody tr", { has: page.getByText(/^rck_live_/) }).first()
  await liveRow.getByRole("button", { name: "Revoke" }).click()
  await liveRow.getByRole("button", { name: "Yes" }).click()

  // O4 + Review Focus #4: still visible, unmistakably revoked.
  const revoked = page.locator("tbody tr", { hasText: "revoked" }).first()
  await expect(revoked).toBeVisible()
  await expect(revoked.getByText("live", { exact: true })).toHaveCount(0)
})
