import { defineConfig } from "@playwright/test"
import { execSync } from "node:child_process"

/**
 * The dev server needs the LOCAL Supabase credentials. They are read from
 * `supabase status` at config time rather than from a file, because SV18 forbids a .env*
 * on this project and the local credentials are fixed and publicly documented anyway —
 * resolving them keeps the literal out of the repo entirely.
 */
function localEnv(): Record<string, string> {
  const out = execSync("supabase status -o env", { encoding: "utf8" })
  const env: Record<string, string> = {}
  for (const line of out.split("\n")) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

const sb = localEnv()

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  // ONE worker, deliberately. Each worker re-evaluates this config, and `supabase status`
  // run concurrently from several workers fails ("Command failed") — which surfaced as an
  // unrelated-looking authoring failure. The suites also share one seeded app each and
  // templates.spec is order-dependent (build → share → adopt → withdraw), so parallelism
  // was never available here anyway.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    storageState: "e2e/fixtures/user-a.json",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: sb.API_URL ?? "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.ANON_KEY ?? "",
      SUPABASE_SERVICE_ROLE_KEY: sb.SERVICE_ROLE_KEY ?? "",
    },
  },
})
