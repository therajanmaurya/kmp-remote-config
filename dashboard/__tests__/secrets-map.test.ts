import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * §11.4 / spec AC11: no NEXT_PUBLIC_* name may resolve to the service-role alias. A
 * NEXT_PUBLIC_ variable is inlined into the client bundle by Next at build time, so this
 * mistake does not fail — it ships, and every visitor receives a key that bypasses RLS on
 * every table.
 */
const MAP = readFileSync(join(__dirname, "..", "cloudflare-secrets.map"), "utf8")

function entries(): Array<[string, string]> {
  return MAP.split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .map((l) => {
      const [name, alias] = l.split("=").map((s) => s.trim())
      return [name, alias] as [string, string]
    })
}

it("parses to at least the three documented entries", () => {
  const names = entries().map(([n]) => n)
  expect(names).toContain("NEXT_PUBLIC_SUPABASE_URL")
  expect(names).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  expect(names).toContain("SUPABASE_SERVICE_ROLE_KEY")
})

it("no NEXT_PUBLIC_ name resolves to the service-role alias", () => {
  const offenders = entries().filter(
    ([name, alias]) => name.startsWith("NEXT_PUBLIC_") && /service-role/.test(alias),
  )
  expect(offenders).toEqual([])
})

it("every alias belongs to this project", () => {
  // A foreign-org alias here would pull another tenant's credential into this dashboard's
  // Worker (RULE-SECRETS-NAMING-CONVENTION-001 NC1).
  const foreign = entries().filter(([, alias]) => !alias.startsWith("kmp-remote-config-"))
  expect(foreign).toEqual([])
})

it("no line carries anything that looks like a VALUE", () => {
  // The map is a name→alias mapping. A pasted JWT or URL here would be a committed secret.
  expect(MAP).not.toMatch(/eyJ[A-Za-z0-9_-]{20}/)
  expect(MAP).not.toMatch(/https?:\/\/[a-z0-9]+\.supabase\.co/)
})
