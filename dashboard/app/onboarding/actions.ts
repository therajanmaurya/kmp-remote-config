"use server"

import { requireUser } from "@/lib/require-user"
import { slugify } from "@/lib/slug"
import { normalizeCertDigest, validateBundleId, validateCertDigest } from "@/lib/onboarding-validate"

export type PlatformBinding = {
  platform: "android" | "ios" | "desktop" | "web" | "wasm"
  bundle_id: string
  /** Android only. Plural because Play App Signing re-signs: the upload key and the app-signing key are different certificates. */
  cert_digests: string[]
}

export type OnboardResult =
  | { ok: true; appId: string; keys: { environment: string; platform: string; key: string }[] }
  | { ok: false; error: string }

/**
 * Register an app end to end: the app row, a live+test key per platform, and the package and
 * certificate bindings those keys are checked against.
 *
 * ONE action rather than a wizard that writes at each step, because a half-registered app is
 * worse than none: an app with no key cannot be integrated, and a key with no bundle binding
 * accepts traffic from any package — which is the control that makes a publishable key safe to
 * ship inside a binary.
 */
export async function onboardApp(input: {
  display_name: string
  bindings: PlatformBinding[]
}): Promise<OnboardResult> {
  const { user, supabase } = await requireUser()

  const display_name = input.display_name.trim()
  if (!display_name) return { ok: false, error: "Give the app a name." }
  const slug = slugify(display_name)
  if (!slug) return { ok: false, error: "That name has no letters or digits to build a slug from." }
  if (input.bindings.length === 0) return { ok: false, error: "Add at least one platform." }

  // Validate EVERYTHING before writing anything. Failing halfway would leave an app row with
  // no keys and send the operator back to a form that now reports a duplicate slug.
  for (const b of input.bindings) {
    const bundle = validateBundleId(b.bundle_id)
    if (!bundle.ok) return { ok: false, error: `${b.platform}: ${bundle.error}` }
    for (const d of b.cert_digests) {
      const digest = validateCertDigest(d)
      if (!digest.ok) return { ok: false, error: `${b.platform}: ${digest.error}` }
    }
  }

  const platforms = [...new Set(input.bindings.map((b) => b.platform))]
  const { data: app, error: appError } = await supabase
    .from("app")
    .insert({ owner_id: user.id, slug, display_name, platforms })
    .select("id")
    .single()

  if (appError || !app) {
    if (appError?.code === "23505") {
      return { ok: false, error: `You already have an app whose slug is "${slug}". Pick a different name.` }
    }
    return { ok: false, error: "Could not create the app." }
  }

  // Every RLS policy resolves membership through app_member, so the owner needs a row there
  // too or they can see the app and none of its contents. Migration 002's trigger may already
  // have inserted it.
  await supabase
    .from("app_member")
    .upsert({ app_id: app.id, user_id: user.id, role: "owner" }, { onConflict: "app_id,user_id" })

  const rows: Record<string, unknown>[] = []
  for (const b of input.bindings) {
    for (const environment of ["live", "test"] as const) {
      const { data: key, error: genError } = await supabase.rpc("generate_publishable_key", {
        p_env: environment,
      })
      if (genError || !key) return { ok: false, error: "Could not generate a publishable key." }
      rows.push({
        app_id: app.id,
        key,
        label: `${b.platform} ${environment}`,
        environment,
        platform: b.platform,
        bundle_id: b.bundle_id.trim(),
        cert_digests: b.cert_digests.map(normalizeCertDigest),
        // The test key skips attestation because Play Integrity rejects debug and sideloaded
        // builds — a developer could otherwise never run their own app against it. The live
        // key stays on the schema default 'preferred', NOT 'required': no attestation verifier
        // is deployed yet, and 'required' would reject all traffic.
        attestation_policy: environment === "test" ? "off" : "preferred",
      })
    }
  }

  const { error: keyError } = await supabase.from("app_key").insert(rows)
  if (keyError) return { ok: false, error: "The app was created but its keys were not. Issue them from the Keys page." }

  // NO revalidatePath here. Revalidating the root layout remounts the tree this action was
  // called from, and the client's `await` then resolves into a component that no longer
  // exists — the result arrives as `undefined` and the wizard dies on `res.ok` having just
  // successfully created the app. The wizard navigates explicitly when the operator is done,
  // which is what refreshes the app list.
  return {
    ok: true,
    appId: app.id,
    // Returned from what we MINTED, not from the insert's RETURNING clause. The select-back
    // depends on the app_member row written moments earlier being visible to this request's
    // RLS context, and it intermittently returned zero rows — leaving the operator on a
    // success screen with an empty key table, which is the one thing they came for. We
    // already hold every key string from generate_publishable_key; there is nothing to re-read.
    keys: rows.map((r) => ({
      environment: String(r.environment),
      platform: String(r.platform),
      key: String(r.key),
    })),
  }
}
