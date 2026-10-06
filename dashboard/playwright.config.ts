import { defineConfig } from "@playwright/test"
import { execSync } from "node:child_process"

/**
 * TWO MODES, and the local stack is OPT-IN.
 *
 * Operator policy 2026-10-06: the server deploys straight to prod and local Supabase is not
 * run routinely — it is slow and resource-hungry (26 containers for other projects were
 * already up). So this config must LOAD and RUN without a local stack. An earlier version
 * called `supabase status` unconditionally at config time and every Playwright invocation
 * died with "No such container" the moment the stack was down, including the production
 * smoke run that needs no stack at all.
 *
 *   default                 → production smoke only (e2e/smoke.spec.ts, needs RCONFIG_SMOKE=1)
 *   RCONFIG_LOCAL_E2E=1     → the full signed-in walkthroughs against a local stack
 *
 * Starting the stack: `supabase start && supabase functions serve --no-verify-jwt &`
 */
const LOCAL = process.env.RCONFIG_LOCAL_E2E === "1"

function localEnv(): Record<string, string> {
  if (!LOCAL) return {}
  let out: string
  try {
    out = execSync("supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  } catch {
    throw new Error(
      "RCONFIG_LOCAL_E2E=1 but the local Supabase stack is not running.\n" +
        "  Start it:  supabase start && supabase functions serve --no-verify-jwt &\n" +
        "  Or drop the flag to run the production smoke suite instead.",
    )
  }
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
  // globalSetup seeds users + apps in the LOCAL stack, so it only applies in local mode.
  ...(LOCAL ? { globalSetup: "./e2e/global-setup.ts" } : {}),
  // Without the local stack the signed-in walkthroughs cannot run; only the smoke suite can.
  testIgnore: LOCAL ? [] : ["**/apps.spec.ts", "**/keys.spec.ts", "**/authoring.spec.ts", "**/templates.spec.ts"],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // ONE worker: in local mode each worker re-evaluates this config and concurrent
  // `supabase status` calls fail; the suites also share one seeded app each and
  // templates.spec is order-dependent.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: LOCAL ? "http://localhost:3000" : "https://rconfig.mobilebytesensei.com",
    ...(LOCAL ? { storageState: "e2e/fixtures/user-a.json" } : {}),
    trace: "retain-on-failure",
  },
  ...(LOCAL
    ? {
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
      }
    : {}),
})
