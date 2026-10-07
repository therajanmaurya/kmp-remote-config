import { expect, test } from "@playwright/test"
import { ids } from "./ids"

/**
 * Phase 02 / T4 — the operator's half of the publish gate.
 *
 * The server-side gate (G-3) is already closed: an unpublished edit cannot reach a device.
 * That makes a NEW failure mode possible — an operator edits, sees the dashboard say nothing,
 * and assumes it shipped. The pill is what prevents that, which is why it is persistent
 * top-bar chrome on every app route rather than a banner on the publish page: a notice you
 * only see once you go looking cannot warn anyone.
 */

test("an edit raises the unpublished pill, and publishing clears it", async ({ page }) => {
  await page.goto(`/apps/${ids.app_a_id}/configs`)

  // Edit a draft. Nothing about this should reach a device yet.
  await page.getByTestId("config-row").first().click()
  await page.getByTestId("payload-title").fill("edited but not published")
  await page.getByTestId("save-config").click()

  // The pill is chrome: it must be visible from the configs list, not only on /publish.
  const pill = page.getByTestId("unpublished-pill")
  await expect(pill).toBeVisible()
  await expect(pill).toContainText("unpublished")

  await pill.click()
  await expect(page).toHaveURL(new RegExp(`/apps/${ids.app_a_id}/publish$`))

  // The diff must name the change, old → new. A count alone would tell an operator that
  // something is staged without telling them what they are about to ship.
  const diff = page.getByTestId("staged-change").first()
  await expect(diff).toBeVisible()
  await expect(diff).toContainText("edited but not published")

  await page.getByTestId("publish-button").click()

  // Both halves matter: the pill clears AND a version appears. A pill that clears without a
  // version row would be the dashboard lying about a publish that never happened.
  await expect(page.getByTestId("unpublished-pill")).toHaveCount(0)
  await page.goto(`/apps/${ids.app_a_id}/history`)
  await expect(page.getByTestId("version-row").first()).toContainText("v1")
})

test("history lists versions newest-first and offers rollback on older ones only", async ({ page }) => {
  await page.goto(`/apps/${ids.app_a_id}/history`)

  const rows = page.getByTestId("version-row")
  await expect(rows.first()).toContainText("Live")

  // The live version offers no rollback-to-itself: it is already what devices are getting,
  // and a button that publishes an identical version is a confusing no-op.
  await expect(rows.first().getByRole("button", { name: /Roll back/i })).toHaveCount(0)
})

test("rolling back creates a NEW version and leaves the one being undone in the list", async ({ page }) => {
  await page.goto(`/apps/${ids.app_a_id}/history`)
  const before = await page.getByTestId("version-row").count()

  await page.getByTestId("version-row").nth(1).getByRole("button", { name: /Roll back/i }).click()
  await page.getByRole("button", { name: "Confirm" }).click()

  // Forward-only: the mistake stays in the record. A history that erases what it undid
  // cannot answer the question the feature exists to answer — what was live, and when.
  await expect(page.getByTestId("version-row")).toHaveCount(before + 1)
})
