import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"
import { execSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Mint signed-in browser states for the e2e suites.
 *
 * The dashboard only offers Google sign-in, so a scripted OAuth round trip is not
 * available. Rather than add a test-only password route to production code — a seam that
 * would then exist in production — this signs in through @supabase/ssr itself with a
 * recording cookie adapter. The LIBRARY produces the cookies, so their names, chunking and
 * base64 encoding are by construction exactly what the app's own server client will read.
 * Hand-rolling the cookie format would be a guess that breaks on the next ssr release.
 *
 * Email/password is used only to obtain the session; it is enabled on the local stack by
 * default and is never enabled in production.
 */

const FIXTURES = join(__dirname, "fixtures")

function localEnv(): Record<string, string> {
  const out = execSync("supabase status -o env", { encoding: "utf8" })
  const env: Record<string, string> = {}
  for (const line of out.split("\n")) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

async function stateFor(url: string, anon: string, email: string, password: string) {
  const jar: Record<string, string> = {}
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
      setAll: (list: { name: string; value: string }[]) =>
        list.forEach(({ name, value }) => (jar[name] = value)),
    },
  })
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)

  return {
    cookies: Object.entries(jar).map(([name, value]) => ({
      name,
      value,
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    })),
    origins: [],
  }
}

export default async function globalSetup() {
  mkdirSync(FIXTURES, { recursive: true })
  const env = localEnv()
  const url = env.API_URL
  const anon = env.ANON_KEY
  const service = env.SERVICE_ROLE_KEY
  if (!url || !anon || !service) throw new Error("local Supabase not running (supabase start)")

  const admin = createClient(url, service, { auth: { persistSession: false } })

  const users = [
    { key: "a", email: "e2e-a@rconfig.test", password: "e2e-password-a-0000" },
    { key: "b", email: "e2e-b@rconfig.test", password: "e2e-password-b-0000" },
  ]

  const ids: Record<string, string> = {}

  for (const u of users) {
    // Idempotent: a second run reuses the user rather than failing on the unique email.
    const { data: created, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
    })
    let userId = created?.user?.id
    if (error) {
      const { data: list } = await admin.auth.admin.listUsers()
      userId = list?.users.find((x) => x.email === u.email)?.id
      if (!userId) throw new Error(`could not create or find ${u.email}: ${error.message}`)
      // Reset the password so a user left over from an earlier run still signs in.
      await admin.auth.admin.updateUserById(userId, { password: u.password })
    }
    ids[`user_${u.key}_id`] = userId!

    const state = await stateFor(url, anon, u.email, u.password)
    writeFileSync(join(FIXTURES, `user-${u.key}.json`), JSON.stringify(state, null, 2))
  }

  // One app per user, created with the service role so the suites start from a known
  // state. app_owner_membership (migration 002) inserts the owner's app_member row.
  for (const u of users) {
    const ownerId = ids[`user_${u.key}_id`]
    const slug = `e2e-${u.key}`
    await admin.from("app").delete().eq("owner_id", ownerId)
    const { data: app, error } = await admin
      .from("app")
      .insert({ owner_id: ownerId, slug, display_name: `E2E App ${u.key.toUpperCase()}`, platforms: ["android"] })
      .select("id")
      .single()
    if (error) throw new Error(`seed app for ${u.key} failed: ${error.message}`)
    ids[`app_${u.key}_id`] = app.id
    await admin.from("app_member").upsert(
      { app_id: app.id, user_id: ownerId, role: "owner" },
      { onConflict: "app_id,user_id" },
    )
  }

  writeFileSync(join(FIXTURES, "ids.json"), JSON.stringify(ids, null, 2))
  console.log(`e2e setup: users + apps ready (${ids.app_a_id}, ${ids.app_b_id})`)
}
