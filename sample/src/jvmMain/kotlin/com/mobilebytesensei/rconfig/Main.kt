package com.mobilebytesensei.rconfig

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import org.koin.core.context.startKoin

/**
 * `./gradlew :sample:run` — a desktop window running the integration end to end.
 *
 * The key comes from an environment variable rather than a constant: a publishable key is not
 * a secret, but a sample with somebody's real key baked in is one that stops working the day
 * that app is deleted, and invites copy-paste into a reader's own project.
 */
fun main() = application {
    val publishableKey = System.getenv("RCONFIG_PUBLISHABLE_KEY")
        ?: error(
            "Set RCONFIG_PUBLISHABLE_KEY to a test key from the rconfig dashboard " +
                "(Keys page, rck_test_…). The test key skips attestation, which is what makes " +
                "it usable from a debug build.",
        )

    val http = HttpClient(CIO)

    // Koin is started once, for the renderer. The values half needs none of this.
    startKoin { modules(sampleModule(publishableKey, platform = "desktop", appVersion = "1.0.0", http = http)) }

    val config = SampleConfig.client(
        publishableKey = publishableKey,
        platform = "desktop",
        appVersion = "1.0.0",
        httpClient = http,
        deviceId = "sample-desktop",
    )

    Window(
        onCloseRequest = ::exitApplication,
        title = "rconfig sample · ${SampleConfig.APPLICATION_ID}",
        state = rememberWindowState(size = DpSize(520.dp, 680.dp)),
    ) {
        SampleScreen(config)
    }
}
