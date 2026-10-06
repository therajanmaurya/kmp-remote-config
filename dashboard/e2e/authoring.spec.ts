import { expect, test } from "@playwright/test"
import { ids } from "./ids"

/**
 * Field names come from the SEEDED schemas, checked against the live template rows — not
 * assumed. update_available is store_url / forced / release_notes / current_version; it has
 * no title or body (that is `announcement`). An earlier version of this file assumed
 * title/body and failed against the real product.
 */
test("AC5: update_available renders its own schema, previews it, and saves disabled", async ({ page }) => {
  await page.goto(`/apps/${ids.app_a_id}/configs/new`)
  await page.getByRole("button", { name: /Update available/i }).click()

  // The form is generated from payload_schema, so these are ITS fields.
  await expect(page.getByLabel("Store url")).toBeVisible()
  await expect(page.getByLabel("Release notes")).toBeVisible()
  await expect(page.getByLabel("Current version")).toBeVisible()

  await page.getByLabel("Store url").fill("https://play.google.com/store/apps/details?id=x")
  await page.getByLabel("Release notes").fill("Version 4.1.0 is ready to install.")
  await page.getByLabel("Current version").fill("4.1.0")
  // `forced` is a required boolean whose schema declares default false — seeded on select,
  // so the control and the payload already agree.
  // update_available allows dialog AND fullscreen, so the picker appears and must be answered.
  await page.getByTestId("display-picker").getByRole("combobox").selectOption("dialog")

  // The preview shows the operator's own copy, derived from the fields this template has.
  await expect(page.getByTestId("config-preview")).toContainText("Version 4.1.0 is ready to install.")

  // Off by default, labelled with what enabling does.
  await expect(page.getByLabel("Enabled")).not.toBeChecked()
  await expect(page.getByText(/will not serve to anyone/i)).toBeVisible()

  await page.getByRole("button", { name: "Save config" }).click()
  await expect(page).toHaveURL(new RegExp(`/apps/${ids.app_a_id}/configs/[0-9a-f-]{36}$`))
  await expect(page.getByText("disabled")).toBeVisible()
})

test("AC12: feature_flag shows no display picker, preview, or impression controls", async ({ page }) => {
  await page.goto(`/apps/${ids.app_a_id}/configs/new`)
  await page.getByRole("button", { name: /Feature flag/i }).click()

  // POSITIVE CONTROL FIRST. Without it this test passes on an empty page — which it did,
  // while the AC5 test next door proved the picker was not rendering content at all.
  // An absence-only assertion cannot tell "correctly hidden" from "nothing rendered".
  await expect(page.getByLabel("Key")).toBeVisible()
  await expect(page.getByLabel("Value")).toBeVisible()
  await expect(page.getByTestId("targeting")).toBeVisible()

  await expect(page.getByTestId("config-preview")).toHaveCount(0)
  await expect(page.getByTestId("display-picker")).toHaveCount(0)
  await expect(page.getByTestId("impression-controls")).toHaveCount(0)
})

test("a required field blocks submit and names itself", async ({ page }) => {
  await page.goto(`/apps/${ids.app_a_id}/configs/new`)
  await page.getByRole("button", { name: /^Announcement/i }).click()
  await expect(page.getByLabel("Title")).toBeVisible() // announcement DOES have title/body
  await page.getByRole("button", { name: "Save config" }).click()

  await expect(page.getByText("Title is required.")).toBeVisible()
  await expect(page).toHaveURL(/\/configs\/new$/) // did not navigate
})

test("empty screens is labelled 'All screens' rather than left ambiguous", async ({ page }) => {
  await page.goto(`/apps/${ids.app_a_id}/configs/new`)
  await page.getByRole("button", { name: /^Announcement/i }).click()
  await expect(page.getByTestId("targeting").getByText("All screens")).toBeVisible()
  await page.getByLabel("Screens").fill("home")
  await expect(page.getByTestId("targeting").getByText("All screens")).toHaveCount(0)
})
