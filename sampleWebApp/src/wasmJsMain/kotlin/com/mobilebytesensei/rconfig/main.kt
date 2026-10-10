package com.mobilebytesensei.rconfig

import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.window.ComposeViewport
import io.ktor.client.HttpClient
import io.ktor.client.engine.js.Js
import kotlinx.browser.localStorage
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** `./gradlew :sampleWebApp:wasmJsBrowserDevelopmentRun` */
@OptIn(ExperimentalComposeUiApi::class, ExperimentalUuidApi::class)
fun main() {
    initRemoteConfig(
        // On the web the key is visible in the bundle no matter where it is read from — which
        // is fine, because a publishable key is not a secret. What protects it is the package
        // binding the server checks on every request.
        publishableKey = sampleKey,
        platform = "web",
        appVersion = "1.0.0",
        httpClient = HttpClient(Js),
        deviceId = webDeviceId(),
    )

    ComposeViewport(viewportContainerId = "composeTarget") { App() }
}

/**
 * Persisted in localStorage so rollout membership survives a reload.
 *
 * A per-session id would re-roll the bucket on every page load, which on the web means every
 * refresh — the flickering a staged rollout must never produce.
 */
@OptIn(ExperimentalUuidApi::class)
private fun webDeviceId(): String =
    localStorage.getItem("rconfig_device_id")
        ?: Uuid.random().toString().also { localStorage.setItem("rconfig_device_id", it) }
