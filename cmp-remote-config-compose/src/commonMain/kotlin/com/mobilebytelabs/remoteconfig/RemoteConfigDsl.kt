package com.mobilebytelabs.remoteconfig

import io.github.mobilebytelabs.kmptoolkit.networkmonitor.NetworkMonitorProvider
import com.mobilebytelabs.remoteconfig.platform.PlatformIdentity

import io.ktor.client.HttpClient

import com.mobilebytelabs.remoteconfig.di.RemoteConfigSettings
import com.mobilebytelabs.remoteconfig.dispatch.ActionDispatcher
import com.mobilebytelabs.remoteconfig.dispatch.ActionHandler
import com.mobilebytelabs.remoteconfig.local.DeviceIdProvider
import com.mobilebytelabs.remoteconfig.local.RemoteConfigLocalStore
import com.mobilebytelabs.remoteconfig.model.ActionType
import com.mobilebytelabs.remoteconfig.network.RemoteConfigService
import com.mobilebytelabs.remoteconfig.ui.RemoteConfigViewModel
import org.koin.core.module.Module
import org.koin.core.module.dsl.singleOf
import org.koin.core.module.dsl.viewModelOf

/**
 * Install cmp-remote-config inside any existing Koin [Module].
 *
 * ```
 * val networkModule = module {
 *     remoteConfig {
 *         publishableKey = "rck_test_…"              // issued in the rconfig dashboard
 *         packageName    = "com.example.app"          // one id for every KMP target
 *         platform       = "android"
 *         appVersion     = BuildConfig.VERSION_NAME
 *         httpClient     = yourKtorClient             // injected: this library ships no engine
 *
 *         action(ActionType.PREMIUM) { _, _ -> AppNavigator.navigateTo("paywall") }
 *         action("open_downloads")    { v, _ -> AppNavigator.navigateTo("downloads?session=${v.orEmpty()}") }
 *     }
 *
 *     // … rest of your bindings …
 * }
 * ```
 *
 * `supabaseUrl` / `supabaseKey` were REMOVED in 5.0.0 — the SDK talks to the rconfig control
 * plane, not to a consumer-supplied Supabase project.
 *
 * Then drop [com.mobilebytelabs.remoteconfig.ui.RemoteConfigHost] anywhere in the Compose tree;
 * action CTAs route to handlers registered here.
 */
fun Module.remoteConfig(block: RemoteConfigBuilder.() -> Unit) {
    // Connectivity comes from cmp-network-monitor, the toolkit's own library, rather than from
    // an expect/actual written here. It already covers every target this SDK ships to and adds
    // validation and captive-portal detection on top — a portal answers DNS and returns a login
    // page, so "an interface is up" and "a request will succeed" are different questions, and
    // the second is the one a fetch cares about.
    //
    // Installed at DI setup rather than at first use: the platform monitors are watchers, and
    // one started by the first fetch has not reported yet — so the single launch the check
    // exists to help is the one launch it would miss. `install` is idempotent.
    NetworkMonitorProvider.install()

    val builder = RemoteConfigBuilder().apply(block)
    val settings = builder.build()

    single { settings }
    single { RemoteConfigLocalStore() }
    single { DeviceIdProvider() }
    single {
        RemoteConfigService(
            baseUrl = settings.baseUrl,
            publishableKey = settings.publishableKey,
            packageName = settings.packageName,
            platform = settings.platform,
            appVersion = settings.appVersion,
            httpClient = settings.httpClient,
            certDigest = settings.certDigest,
            // Bucketing input for a staged rollout. This was MISSING: the module registered a
            // DeviceIdProvider and then built the service without it, so every app integrating
            // through this DSL sent no X-RC-Device — and the server excludes an unidentified
            // caller from any PARTIAL rollout. A staged rollout therefore reached nobody,
            // silently, through the documented path. Nothing failed; the feature just did not
            // work.
            deviceId = get<DeviceIdProvider>().getDeviceId(),
        )
    }
    // The evaluator no longer takes an app-version supplier: the server owns the version
    // window, the schedule and the platform filter in 5.0.0.
    single { RemoteConfigEvaluator(get()) }
    viewModelOf(::RemoteConfigViewModel)

    ActionDispatcher.register(builder.handlers)
}

class RemoteConfigBuilder internal constructor() {
    /**
     * The publishable key issued in the rconfig dashboard (`rck_live_…` / `rck_test_…`).
     *
     * Safe to ship inside the app: it is bound to [packageName] and, on Android, to the
     * signing certificate. What protects it is that binding, not secrecy.
     */
    var publishableKey: String = ""

    /** The host app's package / bundle id. The server 403s `package_mismatch` on a mismatch. */
    var packageName: String = ""

    /**
     * android · ios · desktop · web · wasm. A key pinned to a platform refuses the others.
     *
     * Leave it unset: it defaults to [PlatformIdentity.platform], which the platform knows for
     * certain. A hand-typed value can only be right or a `platform_mismatch` the operator reads
     * as a server fault.
     */
    var platform: String = ""

    /** The host app's version name, e.g. "4.3.0". Used server-side for the version window. */
    var appVersion: String = ""

    /**
     * Android only — the signing certificate digest, when the key registers any.
     *
     * **Leave it unset.** It defaults to [PlatformIdentity.signingDigest], which the SDK reads
     * from `PackageManager` and formats the way the control plane stores it. Set it only when
     * the digest this device can see is NOT the one the server knows — Play App Signing being
     * the real case, where Play re-signs with a certificate the local APK never carries.
     *
     * This used to be the consumer's job, and its failure mode is the reason it no longer is:
     * omit the digest and the server refuses every fetch, so the app serves its bundled
     * defaults indefinitely while looking completely healthy.
     */
    var certDigest: String? = null

    /** Override only for a self-hosted control plane. */
    var baseUrl: String = DEFAULT_BASE_URL

    /**
     * The HTTP client. Supplied by the consumer so this library pulls no platform engine of
     * its own across fifteen targets, and so an app that already has a tuned client (timeouts,
     * proxy, certificate pinning) keeps using it.
     */
    var httpClient: HttpClient? = null


    internal val handlers: MutableMap<ActionType, ActionHandler> = mutableMapOf()

    /** Register a handler for a string action_type (e.g. `"open_downloads"`). */
    fun action(type: String, handler: ActionHandler) {
        handlers[ActionType(type)] = handler
    }

    /** Register a handler for a typed [ActionType] constant (preferred). */
    fun action(type: ActionType, handler: ActionHandler) {
        handlers[type] = handler
    }

    internal fun build(): RemoteConfigSettings {
        require(publishableKey.isNotBlank()) { "remoteConfig { publishableKey } is required" }
        require(packageName.isNotBlank()) { "remoteConfig { packageName } is required" }
        require(appVersion.isNotBlank()) { "remoteConfig { appVersion } is required" }
        val client = requireNotNull(httpClient) { "remoteConfig { httpClient } is required" }
        // `platform` is no longer required: the platform knows it. An explicit value still wins,
        // so a host with an unusual mapping is not blocked.
        return RemoteConfigSettings(
            publishableKey = publishableKey,
            packageName = packageName,
            platform = platform.ifBlank { PlatformIdentity.platform },
            appVersion = appVersion,
            httpClient = client,
            // Resolved by the SDK unless the caller overrides it. Play App Signing is the one
            // case where the local certificate is not the one the server knows.
            certDigest = certDigest ?: PlatformIdentity.signingDigest,
            baseUrl = baseUrl,
        )
    }
}

/**
 * The hosted control plane. A consumer overrides `baseUrl` only when self-hosting.
 *
 * Not a secret: the project ref is public in every client that talks to it, and authority
 * comes from the publishable key + package + cert digest the server verifies per request.
 */
internal const val DEFAULT_BASE_URL = "https://gohifhjcvsawcdhcpbkw.supabase.co/functions/v1"
