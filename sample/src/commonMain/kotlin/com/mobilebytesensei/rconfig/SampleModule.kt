package com.mobilebytesensei.rconfig

import com.mobilebytelabs.remoteconfig.model.ActionType
import com.mobilebytelabs.remoteconfig.remoteConfig
import io.ktor.client.HttpClient
import org.koin.dsl.module

/**
 * The Koin wiring a host app writes, exactly as the dashboard's integration snippet and the
 * `remoteConfig { }` KDoc describe it.
 *
 * This is the half `:sample-headless` deliberately does NOT have. Rendering a config needs a
 * ViewModel, and `RemoteConfigHost` resolves it from Koin — so an app that only READS values
 * can skip all of this, which is why the two samples exist.
 */
fun sampleModule(
    publishableKey: String,
    platform: String,
    appVersion: String,
    http: HttpClient,
) = module {
    remoteConfig {
        this.publishableKey = publishableKey
        this.packageName = SampleConfig.APPLICATION_ID
        this.platform = platform
        this.appVersion = appVersion
        this.httpClient = http

        // Action CTAs route here. A template's primary action carries a type and a value —
        // `store` for an update, `url` for a policy link — and anything unregistered falls
        // through to the dispatcher's default rather than silently doing nothing.
        action(ActionType.STORE) { value, _ -> println("sample: open store → $value") }
        action(ActionType.URL) { value, _ -> println("sample: open url → $value") }
        action(ActionType.ACKNOWLEDGE) { _, _ -> println("sample: acknowledged") }
        action(ActionType.SUBMIT) { value, _ -> println("sample: submitted score $value") }
    }
}
