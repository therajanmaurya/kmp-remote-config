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
internal fun sampleModule(
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
        // `platform` and `certDigest` are deliberately NOT set: the DSL resolves both from
        // PlatformIdentity. Setting them here would re-create the footgun the SDK just removed.

        // NOTE WHAT IS NOT REGISTERED HERE.
        //
        // STORE and URL used to be registered to `println`, which is what a host writes when
        // the SDK leaves the destination to them — and it is why every CTA in this sample did
        // nothing but log. The SDK now opens them itself through KmpToolkit's url launcher, so
        // a dashboard-authored `cta_action` works with no app-side code at all. That is the
        // point: the operator publishes a link, nobody rebuilds the app.
        //
        // A host that needs different behaviour still registers a handler and wins — an app
        // with its own in-app router for deeplinks should not get an external browser.
        //
        // SUBMIT is registered because only the app knows where an NPS score goes; there is no
        // universal destination for it, and the SDK says so rather than guessing.
        action(ActionType.SUBMIT) { value, _ -> println("sample: NPS score submitted → $value") }
    }
}

/**
 * Start Koin once per process — `initKoin()` in the wizard's layout.
 *
 * Only the RENDERER needs this: `RemoteConfigHost` resolves its ViewModel from Koin. An app
 * that reads values and draws nothing can skip it entirely, which is what `:sample-headless`
 * demonstrates.
 */
internal fun initSampleKoin(
    publishableKey: String,
    platform: String,
    appVersion: String,
    http: io.ktor.client.HttpClient,
) {
    org.koin.core.context.startKoin {
        modules(sampleModule(publishableKey, platform, appVersion, http))
    }
}
