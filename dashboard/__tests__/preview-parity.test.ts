import { createClient } from "@supabase/supabase-js"
import { resolvePreview } from "@/lib/resolve-preview"

/**
 * G-8b — the dashboard preview and the DEPLOYED edge function must return the same config set
 * for the same audience.
 *
 * This is the assertion that makes the preview worth having. A preview implemented as a second
 * evaluator drifts from the server silently, and an operator trusting a wrong preview is worse
 * off than one with no preview at all. `resolve-preview.ts` imports the edge function's own
 * modules so they cannot diverge by construction — this test proves the construction holds
 * end to end, against the real deployment, rather than trusting the import.
 *
 * Driven by `supabase/tests/e2e_sdk_contract.sh`, which seeds the sentinel app and exports the
 * three variables below. Skips when they are absent so `npm test` stays runnable offline.
 */

const APP_ID = process.env.RCONFIG_PARITY_APP_ID
const SUPABASE_URL = process.env.RCONFIG_PARITY_SUPABASE_URL
const SERVICE_KEY = process.env.RCONFIG_PARITY_SERVICE_KEY
const FUNC_KEY = process.env.RCONFIG_PARITY_PUBLISHABLE_KEY
const PACKAGE = process.env.RCONFIG_PARITY_PACKAGE

const live = APP_ID && SUPABASE_URL && SERVICE_KEY && FUNC_KEY && PACKAGE ? test : test.skip

live("the preview returns the same configs the deployed function serves", async () => {
  const supabase = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } })

  const audience = {
    platform: "android",
    app_version: "5.0.0",
    sdk_version: "5.0.0",
    screen: null,
    device_id: "parity-device-1",
  }

  const preview = await resolvePreview(supabase, APP_ID!, audience)

  const res = await fetch(`${SUPABASE_URL}/functions/v1/v1-configs`, {
    headers: {
      "X-RC-Key": FUNC_KEY!,
      "X-RC-Package": PACKAGE!,
      "X-RC-Platform": audience.platform,
      "X-RC-App-Version": audience.app_version,
      "X-RC-SDK-Version": audience.sdk_version,
      // The same device id, because it decides rollout membership on both sides.
      "X-RC-Device": audience.device_id,
    },
  })
  expect(res.status).toBe(200)
  const served = await res.json()

  // Compare the ids and the full wire objects. Ids alone would miss a payload the preview
  // renders differently from what ships — which is precisely the drift being guarded against.
  const previewIds = preview.configs.map((c) => (c as { id: string }).id).sort()
  const servedIds = (served.configs as { id: string }[]).map((c) => c.id).sort()
  expect(previewIds).toEqual(servedIds)
  expect(JSON.parse(JSON.stringify(preview.configs))).toEqual(served.configs)

  // Parameters resolve through the same SQL routine on both sides.
  expect(preview.parameters).toEqual(served.parameters ?? {})
})
