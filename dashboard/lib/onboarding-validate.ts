/**
 * Entry-time checks for the two values an integrator most easily gets wrong.
 *
 * Both are verified SERVER side on every config fetch against `app_key`, so a typo here does
 * not fail loudly at onboarding — it fails much later as a `403 package_mismatch` or
 * `cert_mismatch` from a device, with nothing on screen connecting the two. Catching them at
 * entry is the difference between a corrected field and a lost afternoon.
 */

export type Check = { ok: true } | { ok: false; error: string }

/**
 * Reverse-DNS application id — `com.mobilebytesensei.rconfig`.
 *
 * Lowercase only. Android package segments are case-sensitive and conventionally lowercase,
 * and an uppercase segment typed here would mismatch the `X-RC-Package` the SDK actually
 * sends, which is read from the platform rather than from this field.
 */
export function validateBundleId(raw: string): Check {
  const id = raw.trim()
  if (!id) return { ok: false, error: "Enter your application id, for example com.example.app" }
  const segment = /^[a-z][a-z0-9_]*$/
  const parts = id.split(".")
  if (parts.length < 2 || !parts.every((p) => segment.test(p))) {
    // Naming the shape beats naming the rule: "does not match ^[a-z][a-z0-9_]*$" is accurate
    // and tells an operator nothing about what to type instead.
    return {
      ok: false,
      error: "That does not look like an application id. Use reverse-DNS, lowercase, at least two parts — for example com.example.app",
    }
  }
  return { ok: true }
}

const HEX_64 = /^[0-9a-f]{64}$/i

/** Strip whitespace and colons; what remains should be the raw hex. */
function hexOf(raw: string): string {
  return raw.trim().replace(/[\s:]/g, "")
}

/**
 * SHA-256 signing certificate digest.
 *
 * SHA-256 specifically, and the SHA-1 rejection below is the important one: `keytool` prints
 * SHA1 and SHA256 together with SHA1 FIRST, so it is the value most likely to be pasted. Play
 * App Signing reports SHA-256, so a SHA-1 digest here can never match and the only symptom is
 * a bare `cert_mismatch` on device.
 */
export function validateCertDigest(raw: string): Check {
  const hex = hexOf(raw)
  if (!hex) return { ok: false, error: "Enter the SHA-256 certificate fingerprint." }
  if (hex.length === 40 && /^[0-9a-f]{40}$/i.test(hex)) {
    return {
      ok: false,
      error: "That is a SHA-1 fingerprint. Play App Signing reports SHA-256 — use the SHA256 line from `keytool -list -v` or the Play Console.",
    }
  }
  if (!HEX_64.test(hex)) {
    return {
      ok: false,
      error: "A SHA-256 fingerprint is 64 hex characters, with or without colons.",
    }
  }
  return { ok: true }
}

/**
 * The stored form: uppercase, colon-separated byte pairs — what `keytool` and the Play Console
 * display, so an operator can compare the dashboard against their tooling without transcribing.
 */
export function normalizeCertDigest(raw: string): string {
  const hex = hexOf(raw).toUpperCase()
  return hex.match(/.{2}/g)?.join(":") ?? hex
}
