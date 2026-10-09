package com.mobilebytesensei.rconfig

import com.mobilebytelabs.remoteconfig.platform.PlatformIdentity
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The assertion that distinguishes a WORKING integration from a silently-defaulting one, run on
 * every target the sample builds for.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────
 * Android was verified by screenshot, which is the right evidence for a rendered surface but is
 * unavailable for desktop, web and iOS without an app bundle or a display. The SDK contract is
 * identical on all of them though, and it is checkable without a screen:
 *
 *   `PlatformIdentity.platform` must name this target, and `signingDigest` must be non-null on
 *   android and null everywhere else.
 *
 * That second half is the part worth pinning. A `signingDigest` that returned non-null on a
 * platform with no signing concept would be sent as `X-RC-Cert`, and the server compares it
 * against the digests the KEY registers — so a stray value turns every fetch into a
 * `cert_mismatch` on a platform that was working a moment ago. The failure would look like a
 * server problem on exactly the platforms nobody screenshots.
 *
 * These are deliberately OFFLINE. A test that reached the real control plane would couple the
 * sample's build to published state — someone revokes a key or republishes a parameter and the
 * build goes red for a reason that has nothing to do with the code. The network path is verified
 * on device (android) and in the browser (web); what belongs here is the platform contract that
 * must hold before any request is even formed.
 */
class ServedValueIntegrationTest {

    @Test
    fun the_platform_names_itself() {
        val p = PlatformIdentity.platform
        assertTrue(
            p in setOf("android", "ios", "desktop", "web", "wasm", "native"),
            "PlatformIdentity.platform returned '$p', which the server does not accept in " +
                "X-RC-Platform — it answers 403 platform_mismatch, and the operator reads that " +
                "as a server fault rather than a client one",
        )
    }

    @Test
    fun the_signing_digest_is_android_only_and_correctly_shaped() {
        val digest = PlatformIdentity.signingDigest
        if (PlatformIdentity.platform == "android") {
            // Non-null is the whole point: a null digest here is the exact defect that made the
            // sample serve its bundled defaults while looking healthy.
            assertNotNull(digest, "android must resolve a signing digest from PackageManager")
            assertEquals(
                95, digest.length,
                "the control plane stores SHA-256 as 32 uppercase hex pairs joined by colons " +
                    "(95 chars). A different shape is compared byte-for-byte by the edge " +
                    "function and silently never matches: got '$digest'",
            )
            assertTrue(
                digest.all { it in "0123456789ABCDEF:" },
                "digest must be UPPERCASE colon-separated hex; lowercase never matches: '$digest'",
            )
        } else {
            // A stray non-null here would be sent as X-RC-Cert and turn a working platform into
            // a cert_mismatch — on precisely the targets that have no screenshot to catch it.
            assertNull(
                digest,
                "only android has a signing certificate; ${PlatformIdentity.platform} returned " +
                    "'$digest', which would be sent as X-RC-Cert and refused",
            )
        }
    }

    @Test
    fun bundled_defaults_exist_for_every_value_the_sample_reads() {
        // Without a bundled default a first launch with no network renders nothing, which is
        // worse than having no remote config at all. The sample reads exactly these three, and
        // the keys must match what the control plane publishes — a typo on either side shows up
        // as a value that never updates, which reads as a server problem.
        val defaults = SampleConfig.defaults
        for (key in listOf("welcome_banner_enabled", "max_upload_mb", "checkout_copy")) {
            assertNotNull(
                defaults[key],
                "no bundled default for '$key': with no network a first launch shows nothing " +
                    "for it, and a key mismatch with the server is invisible until someone " +
                    "notices the value never changes",
            )
        }
    }
}
