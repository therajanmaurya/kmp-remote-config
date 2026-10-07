package com.mobilebytesensei.rconfig

import androidx.compose.runtime.Composable
import io.ktor.client.HttpClient

/**
 * The single composable every platform entry point calls, as the Kotlin Multiplatform wizard
 * lays it out: `App()` lives in the shared module and `MainActivity`, `MainViewController`,
 * the desktop `main()` and the web `main()` are four thin shells around it.
 *
 * The shells differ only in how a platform starts a UI — not in what the app IS — which is
 * exactly the separation that makes the integration below written once.
 */
@Composable
fun App(config: SampleRemoteConfig = requireConfig()) {
    SampleScreen(config)
}

/**
 * Built once per process by [initRemoteConfig] and read by [App].
 *
 * Deliberately not a Koin binding: `SampleRemoteConfig` needs a platform HttpClient engine,
 * which each entry point supplies, and threading that through DI would obscure the one thing
 * this sample exists to show.
 */
private var instance: SampleRemoteConfig? = null

internal fun requireConfig(): SampleRemoteConfig =
    instance ?: error("call initRemoteConfig(...) from your platform entry point before App()")

/**
 * What every platform entry point calls first.
 *
 * @param publishableKey a `rck_test_…` key for a debug build — it skips attestation, because
 *   Play Integrity rejects debug and sideloaded builds and a developer could otherwise never
 *   run their own app. Ship the live key in a release build.
 * @param deviceId a stable per-install id. Null is honest rather than convenient: the server
 *   EXCLUDES an unidentified caller from a partial rollout, so a missing id makes a staged
 *   rollout reach fewer devices, never more.
 */
fun initRemoteConfig(
    publishableKey: String,
    platform: String,
    appVersion: String,
    httpClient: HttpClient,
    deviceId: String? = null,
) {
    initSampleKoin(publishableKey, platform, appVersion, httpClient)
    instance = SampleConfig.client(
        publishableKey = publishableKey,
        platform = platform,
        appVersion = appVersion,
        httpClient = httpClient,
        deviceId = deviceId,
    )
}
