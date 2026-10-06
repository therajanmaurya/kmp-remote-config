import { test } from "@playwright/test"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"
import { mkdirSync } from "node:fs"

/**
 * Captures the LIVE deployed dashboard for visual review.
 *
 * Seeds a clearly-labelled demo tenant on production, mints a session the same way the
 * local e2e does (@supabase/ssr produces the cookies, so their encoding is by construction
 * what the app reads), screenshots every route, then deletes everything it created.
 * Sentinel ids 5e1f0002-* so cleanup is unambiguous.
 */
const BASE = "https://rconfig.mobilebytesensei.com"
const SHOTS = "/private/tmp/claude-501/-Users-therajanmaurya-project-development-claude-product-cycle/c2d7603d-8bbd-4e61-97ae-c06c367d2e60/scratchpad/shots"
const URL_ = process.env.PROD_URL!, SVC = process.env.PROD_SVC!, ANON = process.env.PROD_ANON!

const APP = "5e1f0002-0000-0000-0000-000000000002"
const UID = "5e1f0002-0000-0000-0000-000000000001"
const EMAIL = "visual-review@rconfig.local"
const PASS = "visual-review-pw-0001"

test("capture the live dashboard", async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  const admin = createClient(URL_, SVC, { auth: { persistSession: false } })

  // ---- seed a demo tenant ----
  await admin.auth.admin.createUser({ id: UID, email: EMAIL, password: PASS, email_confirm: true })
    .catch(() => admin.auth.admin.updateUserById(UID, { password: PASS }))
  await admin.from("app").upsert({
    id: APP, owner_id: UID, slug: "lumen-photos", display_name: "Lumen Photos",
    platforms: ["android", "ios"],
  })
  await admin.from("app_member").upsert({ app_id: APP, user_id: UID, role: "owner" },
    { onConflict: "app_id,user_id" })

  for (const env of ["live", "test"] as const) {
    const { data: key } = await admin.rpc("generate_publishable_key", { p_env: env })
    await admin.from("app_key").insert({
      app_id: APP, key, environment: env, platform: "android",
      bundle_id: "com.lumen.photos",
      attestation_policy: env === "test" ? "off" : "preferred",
    })
  }

  await admin.from("config").insert([
    { app_id: APP, template_id: "update_available", display: "dialog", is_enabled: true,
      priority: 10, platforms: ["android"], screens: [],
      payload: { store_url: "https://play.google.com/store/apps/details?id=com.lumen.photos",
                 forced: false, current_version: "4.0.3",
                 release_notes: "Faster sync, a fix for the crash on opening a shared album, and dark-mode polish." } },
    { app_id: APP, template_id: "announcement", display: "dialog", is_enabled: false,
      priority: 5, screens: ["home"], platforms: [],
      payload: { title: "Introducing saved searches",
                 body: "Keep the filters you use most and jump straight back to them.",
                 cta_label: "Show me", cta_action: "app://search/saved" } },
    { app_id: APP, template_id: "incident_outage", display: "banner", is_enabled: true,
      priority: 20, screens: [], platforms: [],
      payload: { title: "Sync is delayed", severity: "warning",
                 body: "New photos may take up to an hour to appear on other devices.",
                 status_url: "https://status.lumen.example" } },
  ])

  // ---- mint a session (the library writes the cookies, so the format is right) ----
  const jar: Record<string, string> = {}
  const ssr = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
      setAll: (l: { name: string; value: string }[]) => l.forEach(({ name, value }) => (jar[name] = value)),
    },
  })
  const { error } = await ssr.auth.signInWithPassword({ email: EMAIL, password: PASS })
  if (error) throw new Error(`sign-in failed: ${error.message}`)

  const ctx = await browser.newContext({
    storageState: {
      cookies: Object.entries(jar).map(([name, value]) => ({
        name, value, domain: "rconfig.mobilebytesensei.com", path: "/",
        expires: -1, httpOnly: false, secure: true, sameSite: "Lax" as const,
      })),
      origins: [],
    },
    viewport: { width: 1280, height: 900 },
  })
  const page = await ctx.newPage()

  const routes: Array<[string, string]> = [
    ["01-app-list", "/"],
    ["02-app-overview", `/apps/${APP}`],
    ["03-keys", `/apps/${APP}/keys`],
    ["04-configs", `/apps/${APP}/configs`],
    ["05-authoring", `/apps/${APP}/configs/new`],
    ["06-templates", `/apps/${APP}/templates`],
    ["07-template-builder", `/apps/${APP}/templates/new`],
    ["08-community", "/community"],
  ]
  for (const [name, path] of routes) {
    await page.goto(BASE + path, { waitUntil: "networkidle" })
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
    console.log(`  captured ${name} ← ${path}`)
  }

  // authoring with a template selected — the screen that carries the product
  await page.goto(`${BASE}/apps/${APP}/configs/new`, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: /Update available/i }).click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${SHOTS}/09-authoring-filled.png`, fullPage: true })
  console.log("  captured 09-authoring-filled")

  await ctx.close()

  // ---- clean up every seeded row ----
  await admin.from("config").delete().eq("app_id", APP)
  await admin.from("app_key").delete().eq("app_id", APP)
  await admin.from("app_member").delete().eq("app_id", APP)
  await admin.from("app").delete().eq("id", APP)
  await admin.auth.admin.deleteUser(UID)
  console.log("  demo tenant removed")
})
