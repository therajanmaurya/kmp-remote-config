import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

/**
 * The three things that made navigating the dashboard feel broken.
 *
 * None of them announce themselves when they regress. There is no error, no failing render and
 * no console warning — the app simply goes back to freezing on the old section for a second per
 * click, which is indistinguishable from "the network was slow" until someone measures it again.
 * That is exactly the kind of defect that needs a test rather than a comment.
 *
 * Measured before the fix: an unauthenticated `GET /dashboard` — no render, no queries, a 307 —
 * took 0.58-0.72s, which is one edge-to-Supabase auth round trip. A signed-in view paid that
 * three times over (middleware, layout, page), with nothing on screen to say it was working.
 */
const dash = (p: string) => join(__dirname, "..", p)
const read = (p: string) => readFileSync(dash(p), "utf8")

describe("a navigation costs one auth hop and shows something immediately", () => {
  test("requireUser is memoised per request", () => {
    const src = read("lib/require-user.ts")
    // `getUser()` is a network call to Supabase Auth, not a local JWT decode. It is called from
    // 28 places and a single view hits it twice — the [id] layout and the page inside it.
    expect(src).toMatch(/import\s*\{[^}]*\bcache\b[^}]*\}\s*from\s*"react"/)
    expect(src).toMatch(/export const requireUser = cache\(/)
  })

  test("the app layout does not derive anything from the pathname", () => {
    const src = read("app/apps/[id]/layout.tsx")
    // Reading headers() here makes the layout's output a function of the URL, which means the
    // router cannot reuse it when moving between its own children — so every section change
    // re-ran an auth validation plus three queries whose answers had not changed.
    //
    // The highlight lives in SidebarNav/ActiveSectionCrumb (client, usePathname) instead. If
    // this assertion fails, staleTimes below also becomes unsafe: a reused layout would keep
    // highlighting the row you navigated away from.
    expect(src).not.toMatch(/from "next\/headers"/)
    expect(src).not.toMatch(/resolveSection/)
  })

  test("the router may reuse an unchanged shell between sections", () => {
    const src = read("next.config.mjs")
    // Next 14.2 defaults dynamic to 0 — refetch every segment on every navigation.
    expect(src).toMatch(/staleTimes/)
    expect(src).toMatch(/dynamic:\s*(?!0\b)\d+/)
  })

  test("every section a user clicks into has a loading boundary", () => {
    // Without one the router holds the PREVIOUS page on screen for the whole server render:
    // the click appears to do nothing. It also makes <Link> prefetch useless, since a dynamic
    // route can only be prerendered as far as its nearest loading boundary.
    for (const seg of [
      "app/apps/[id]",
      "app/apps",
      "app/dashboard",
      "app/account/tokens",
      "app/admin/members",
      "app/community",
    ]) {
      expect(existsSync(dash(join(seg, "loading.tsx")))).toBe(true)
    }
  })

  test("the sidebar and breadcrumb resolve the active route on the client", () => {
    for (const f of ["components/SidebarNav.tsx", "components/ActiveSectionCrumb.tsx"]) {
      const src = read(f)
      expect(src.startsWith('"use client"')).toBe(true)
      expect(src).toMatch(/usePathname/)
    }
    // Shell must not take an `active` prop again — that is the server-derived highlight coming
    // back in through a different door.
    expect(read("components/Shell.tsx")).not.toMatch(/\bactive:\s*string/)
  })
})
