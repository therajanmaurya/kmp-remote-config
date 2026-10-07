import { normalizeCertDigest, validateBundleId, validateCertDigest } from "@/lib/onboarding-validate"

/**
 * Onboarding asks for the two values an integrator most easily gets wrong, and where being
 * wrong is silent: the bundle id and the signing certificate digest. Both are checked SERVER
 * side against `app_key`, so a typo does not surface as a validation error — it surfaces much
 * later as `403 package_mismatch` from a device, with nothing on screen connecting the two.
 *
 * Catching them at entry is the difference between a corrected field and an afternoon lost.
 */

describe("bundle id", () => {
  test.each([
    "com.mobilebytesensei.rconfig",
    "com.lumen.photos",
    "io.github.example.app2",
    "a.b",
  ])("accepts %s", (id) => {
    expect(validateBundleId(id).ok).toBe(true)
  })

  test.each([
    ["", "empty"],
    ["com", "a single segment is not reverse-DNS"],
    ["com.", "trailing dot"],
    [".com.app", "leading dot"],
    ["com..app", "empty segment"],
    ["com.My App", "a space"],
    ["com.1app", "segment starting with a digit"],
    ["COM.Example.App", "uppercase is not valid in an Android package"],
  ])("rejects %s (%s)", (id) => {
    expect(validateBundleId(id).ok).toBe(false)
  })

  test("the rejection explains what to type, not which rule failed", () => {
    const res = validateBundleId("com")
    // Narrow explicitly: expect() does not refine the union for the compiler, and casting
    // would let a future `ok: true` regression through this assertion unnoticed.
    if (res.ok) throw new Error("expected 'com' to be rejected")
    // "does not match ^[a-z]..." would be accurate and useless.
    expect(res.error).toMatch(/com\.example/i)
  })
})

describe("certificate digest", () => {
  const COLONED = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89"
  const BARE = COLONED.replace(/:/g, "")

  test("accepts the colon-separated form Play and keytool print", () => {
    expect(validateCertDigest(COLONED).ok).toBe(true)
  })

  test("accepts the bare hex form, because people paste both", () => {
    expect(validateCertDigest(BARE).ok).toBe(true)
  })

  test("accepts lowercase and normalizes it", () => {
    expect(validateCertDigest(COLONED.toLowerCase()).ok).toBe(true)
    expect(normalizeCertDigest(COLONED.toLowerCase())).toBe(COLONED)
  })

  test("normalizes the bare form to the colon form stored in app_key", () => {
    expect(normalizeCertDigest(BARE)).toBe(COLONED)
  })

  test("rejects a SHA-1 digest, naming the problem", () => {
    // 40 hex chars. This is the one an Android developer is most likely to paste, because
    // `keytool` prints SHA1 and SHA256 together and SHA1 comes first. Play App Signing
    // reports SHA-256, so a SHA-1 here never matches and the error on device is a bare
    // cert_mismatch.
    const sha1 = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01"
    const res = validateCertDigest(sha1)
    if (res.ok) throw new Error("expected a SHA-1 digest to be rejected")
    expect(res.error).toMatch(/SHA-?256/i)
  })

  test("rejects non-hex and the wrong length", () => {
    expect(validateCertDigest("").ok).toBe(false)
    expect(validateCertDigest("not a digest").ok).toBe(false)
    expect(validateCertDigest(BARE.slice(0, 60)).ok).toBe(false)
    expect(validateCertDigest(BARE + "AB").ok).toBe(false)
    expect(validateCertDigest(BARE.replace(/^AB/, "ZZ")).ok).toBe(false)
  })

  test("tolerates whitespace around a pasted value", () => {
    expect(validateCertDigest(`  ${COLONED}\n`).ok).toBe(true)
    expect(normalizeCertDigest(`  ${COLONED}\n`)).toBe(COLONED)
  })
})
