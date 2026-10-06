export type KeyTone = "live" | "test" | "revoked"

/**
 * Revocation outranks environment.
 *
 * A revoked live key rendered as "live" is the display that costs an operator an
 * afternoon: the SDK is returning 403 and the dashboard says the key is fine. O4 keeps
 * revoked keys visible (they are publishable and appear in SDK logs), so the badge is the
 * only thing distinguishing them.
 */
export function keyBadge(key: { environment: string; revoked_at: string | null }): {
  label: string
  tone: KeyTone
} {
  if (key.revoked_at) return { label: "revoked", tone: "revoked" }
  return key.environment === "live"
    ? { label: "live", tone: "live" }
    : { label: "test", tone: "test" }
}
