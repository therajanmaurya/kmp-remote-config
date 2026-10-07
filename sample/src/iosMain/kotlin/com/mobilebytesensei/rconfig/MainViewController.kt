package com.mobilebytesensei.rconfig

import androidx.compose.ui.window.ComposeUIViewController
import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import platform.Foundation.NSBundle
import platform.UIKit.UIDevice

/**
 * The iOS entry point, called from `ContentView.swift`.
 *
 * Darwin is the engine here because the SDK ships none of its own across fifteen targets — the
 * `HttpClient` is injected precisely so each platform brings the engine it already uses.
 */
fun MainViewController(publishableKey: String) = ComposeUIViewController {
    initRemoteConfig(
        publishableKey = publishableKey,
        platform = "ios",
        // The real version from the bundle, not a constant: the server evaluates the
        // app-version window against whatever this reports.
        appVersion = NSBundle.mainBundle.infoDictionary
            ?.get("CFBundleShortVersionString") as? String ?: "1.0.0",
        httpClient = HttpClient(Darwin),
        deviceId = UIDevice.currentDevice.identifierForVendor?.UUIDString,
    )
    App()
}
