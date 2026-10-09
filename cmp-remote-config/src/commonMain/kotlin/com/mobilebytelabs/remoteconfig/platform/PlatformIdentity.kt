/*
 * Copyright 2026 MobileByteLabs
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 */
package com.mobilebytelabs.remoteconfig.platform

/**
 * What the PLATFORM knows about the host app, so a consumer does not have to tell us.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────
 * The server binds an android publishable key to the app's signing certificate and refuses any
 * caller that cannot prove which certificate signed it (403 `cert_mismatch`). Reading that
 * certificate needs `PackageManager`, which is android-only and therefore cannot live in
 * `commonMain` — so until now every android consumer had to compute it themselves and pass it
 * in.
 *
 * That shape has a failure mode nobody notices: forget it, and the SDK serves its bundled
 * defaults forever while the app looks perfectly healthy. Our own sample forgot it, and the
 * first real device run of `/idea-rconfig` (2026-10-09) is what surfaced it — three separate
 * times, because the digest had to be threaded through two construction sites.
 *
 * A correctness requirement that the platform can satisfy on its own should not be delegated to
 * every caller. So the SDK resolves it, and the consumer API loses a parameter instead of
 * gaining a footgun.
 *
 * ── What a consumer sees ─────────────────────────────────────────────────────────────────────
 * Nothing, normally. `remoteConfig { }` fills `platform` and `certDigest` from here when they
 * are not set explicitly, so the integration shrinks to the two things only the app knows:
 *
 *     remoteConfig {
 *         publishableKey = "rck_test_…"
 *         packageName = "com.example.app"
 *         appVersion = "1.4.2"
 *         httpClient = HttpClient(…)
 *     }
 *
 * Both remain overridable — a host that signs through Play App Signing may need to present a
 * digest this device cannot see, and an explicit value always wins.
 */
public object PlatformIdentity {

    /**
     * The platform token the server expects in `X-RC-Platform`: one of
     * `android` · `ios` · `desktop` · `web` · `wasm` · `native`.
     *
     * Resolved rather than asked for, because a typo here is a `platform_mismatch` the operator
     * reads as a server fault.
     */
    public val platform: String get() = platformName()

    /**
     * The app's SHA-256 signing-certificate digest in the form the control plane stores —
     * uppercase hex, colon-separated, matching what the Play Console and `android-cert-digest.sh`
     * print.
     *
     * **Non-null on android only.** Every other platform returns null, and that is correct
     * rather than a gap: no other platform has an equivalent check, and the server drives the
     * comparison off whether the KEY registers digests, not off the platform header.
     */
    public val signingDigest: String? get() = platformSigningDigest()
}

/** `android` · `ios` · `desktop` · `web` · `wasm` · `native`. */
internal expect fun platformName(): String

/**
 * SHA-256 of the signing certificate, uppercase colon-separated, or null where the concept does
 * not exist. Returns null rather than throwing on any failure: a missing digest produces a
 * server refusal the SDK surfaces, which is a better outcome than an exception thrown out of a
 * Koin module during startup.
 */
internal expect fun platformSigningDigest(): String?
