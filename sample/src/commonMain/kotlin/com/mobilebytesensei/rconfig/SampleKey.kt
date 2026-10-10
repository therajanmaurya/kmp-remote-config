package com.mobilebytesensei.rconfig

/**
 * The app's publishable key. ONE key, for every target.
 *
 * ── What changed, and why it matters ────────────────────────────────────────────────────────
 * Each host used to carry its own literal, because the control plane minted a key per platform:
 * eight rows on the Keys page for a single app, five different constants in five source files,
 * and "which key is this build using" was a question with five answers.
 *
 * None of that was ever required by delivery — `_shared/identity.ts` has always read
 * `app_key.platform IS NULL` as "any platform". Migration 021 stopped the MINTING path
 * insisting otherwise, so an app now gets one live key and one test key, full stop.
 *
 * A Kotlin Multiplatform app is one application that happens to run on five targets. Its
 * credential should be one value in one file, and that is what this is — read by the Android,
 * desktop, web and headless hosts directly, and by the iOS host through the generated framework
 * (`SampleKeyKt.sampleKey` in Swift). Pointing the sample at a different app is now a one-line
 * change rather than five.
 *
 * ── live vs test is NOT the same axis ───────────────────────────────────────────────────────
 * This is the TEST key: `attestation_policy = off`, because Play Integrity rejects sideloaded
 * and debug builds. The live key is for release builds. That split stays — collapsing it would
 * mean either no attestation in production or no debug builds at all. Two keys, not one; what
 * went away was the multiplication by platform.
 *
 * ── Public, deliberately ────────────────────────────────────────────────────────────────────
 * A publishable key ships inside every client binary; anyone can extract it. What protects it
 * is the package + certificate binding and attestation, not secrecy — which is why it belongs
 * in committed source. The SECRET half of this product is the `rcp_` access token, which lives
 * in the vault and never appears here. Do not confuse the two.
 */
public const val sampleKey: String = "rck_test_6ru6HtYkl9xYJLvdAawTxiyJGyUgoj1E"
