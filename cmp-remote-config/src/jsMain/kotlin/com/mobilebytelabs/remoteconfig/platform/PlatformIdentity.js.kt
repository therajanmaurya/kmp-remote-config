/*
 * Copyright 2026 MobileByteLabs · Apache 2.0
 */
package com.mobilebytelabs.remoteconfig.platform

/**
 * No signing-certificate concept on this platform, so the digest is null — correct rather than
 * missing. The server drives the cert check off whether the KEY registers digests, not off the
 * platform header, so a null here simply means there is nothing to prove.
 */
internal actual fun platformSigningDigest(): String? = null

internal actual fun platformName(): String = "web"
