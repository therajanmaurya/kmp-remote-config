package com.mobilebytesensei.rconfig

import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp

/**
 * The Android shell. Everything it does is start the SDK and call the shared `App()` — the
 * wizard's shape, and the reason the integration is written once rather than per platform.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        initRemoteConfig(
            // From a build config or a resource in a real app. A publishable key is not a
            // secret — it ships inside the binary by design — but it IS bound to this package
            // and, in production, to the signing certificate.
            publishableKey = BuildConfigKey.VALUE,
            platform = "android",
            appVersion = packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.0",
            httpClient = HttpClient(OkHttp),
            // ANDROID_ID is stable per app-signing-key per device and needs no permission.
            // A rollout only needs STABILITY, not identity, so this is the weakest id that works.
            deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID),
        )

        setContent { App() }
    }
}

/**
 * Committed on purpose. A publishable key is PUBLIC — it ships inside the APK, so anyone can
 * extract it in a minute, and hiding it would buy nothing while stopping a developer from
 * reading the key their own app already contains. What protects it is the BINDING the server
 * checks on every request: applicationId `com.mobilebytesensei.rconfig`, the SHA-256 signing
 * digest, and the environment.
 *
 * This is the TEST key, which carries `attestation_policy: off` so a debug build runs. The
 * live key is bound to the same package and digest and belongs in a release build.
 *
 * The SECRET half of this product is the `rcp_` access token, which lives in the vault and
 * never appears in source. The two are opposites; do not confuse them.
 */
// The key now lives in commonMain (`SampleKey.kt`) and is shared by every host. Keeping a
// per-host copy was only ever necessary because the control plane minted a key per platform.
internal object BuildConfigKey {
    const val VALUE: String = sampleKey
}
