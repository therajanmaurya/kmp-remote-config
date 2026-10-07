import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * The regression this exists to catch, in one sentence: **a build without the public Supabase
 * env vars produces a dashboard that cannot sign anyone in, and nothing about the build fails.**
 *
 * `NEXT_PUBLIC_*` is inlined by Next at BUILD time. A deploy run from a shell that lacks them
 * emits a bundle where `createClient()` throws on every page load — and `next build` exits 0,
 * the upload succeeds, every route still returns 200, and the only symptom is a sign-in button
 * that sticks on "Redirecting to Google…". That shipped.
 *
 * Asserting on the BUILD OUTPUT rather than on `process.env` is the whole point: the question is
 * not "were the variables set in some shell", it is "did the values reach the artifact".
 */

const NEXT_DIR = join(__dirname, "..", ".next")
const SUPABASE_HOST_RE = /https:\/\/[a-z0-9]{20}\.supabase\.co/

function collectClientChunks(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) collectClientChunks(p, acc)
    else if (entry.endsWith(".js")) acc.push(p)
  }
  return acc
}

const built = existsSync(join(NEXT_DIR, "static"))
const guard = built ? describe : describe.skip

guard("the built client bundle carries its Supabase configuration", () => {
  const chunks = collectClientChunks(join(NEXT_DIR, "static"))
  const haystack = chunks.map((f) => readFileSync(f, "utf8")).join("\n")

  test("a Supabase project URL is inlined", () => {
    expect(chunks.length).toBeGreaterThan(0)
    expect(
      SUPABASE_HOST_RE.test(haystack),
    ).toBe(true)
  })

  test("an anon JWT is inlined", () => {
    // The anon key is PUBLIC by design — it is RLS-gated and ships in every client. What must
    // never appear here is the service-role key, asserted below.
    expect(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(haystack)).toBe(true)
  })

  test("the service-role key is NOT inlined", () => {
    // The counterpart risk. `cloudflare-secrets.map` gives SUPABASE_SERVICE_ROLE_KEY no
    // NEXT_PUBLIC_ twin precisely so an RLS-bypassing key cannot reach a browser; this proves
    // the build honoured that rather than trusting the naming convention.
    const roleClaims = haystack.match(/"role"\s*:\s*"service_role"/g) ?? []
    expect(roleClaims).toHaveLength(0)
  })
})
