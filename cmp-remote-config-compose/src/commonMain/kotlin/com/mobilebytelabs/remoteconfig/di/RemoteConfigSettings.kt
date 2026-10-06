package com.mobilebytelabs.remoteconfig.di

import io.ktor.client.HttpClient

/**
 * Resolved configuration for the rconfig SDK, built by `remoteConfig { … }`.
 *
 * 5.0.0 replaced `supabaseUrl` / `supabaseKey` — the SDK no longer talks to a consumer's own
 * Supabase project. It calls the rconfig control plane with a publishable key bound to the
 * app's package and signing certificate.
 */
internal data class RemoteConfigSettings(
    val publishableKey: String,
    val packageName: String,
    val platform: String,
    val appVersion: String,
    val httpClient: HttpClient,
    val certDigest: String? = null,
    val baseUrl: String,
)
