package com.mobilebytesensei.rconfig

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import java.util.prefs.Preferences
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** `./gradlew :sampleDesktopApp:run` */
fun main() {
    val publishableKey = System.getenv("RCONFIG_PUBLISHABLE_KEY")
        ?: error(
            "Set RCONFIG_PUBLISHABLE_KEY to a test key from the rconfig dashboard " +
                "(Keys page, rck_test_…). The test key skips attestation, which is what makes " +
                "it usable from a debug build.",
        )

    initRemoteConfig(
        publishableKey = publishableKey,
        platform = "desktop",
        appVersion = "1.0.0",
        httpClient = HttpClient(CIO),
        deviceId = desktopDeviceId(),
    )

    application {
        Window(
            onCloseRequest = ::exitApplication,
            title = "rconfig sample · ${SampleConfig.APPLICATION_ID}",
            state = rememberWindowState(size = DpSize(520.dp, 700.dp)),
        ) {
            App()
        }
    }
}

/**
 * A stable per-install id, persisted in user preferences.
 *
 * Stability is the whole requirement — bucketing is a pure function of (config, device), so an
 * id regenerated each launch would re-roll rollout membership every time the app started. That
 * surfaces as "the feature keeps appearing and disappearing", which almost nobody traces back
 * to a rollout setting.
 */
@OptIn(ExperimentalUuidApi::class)
private fun desktopDeviceId(): String {
    val prefs = Preferences.userRoot().node("com.mobilebytesensei.rconfig")
    return prefs.get("device_id", null) ?: Uuid.random().toString().also { prefs.put("device_id", it) }
}
