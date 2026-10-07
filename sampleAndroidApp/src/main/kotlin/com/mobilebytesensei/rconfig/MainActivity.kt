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
 * Replaced by a real `BuildConfig` field or a resource when this sample is wired into a
 * project. Kept as an explicit constant so the file compiles standalone and so nobody's live
 * key ends up committed here.
 */
internal object BuildConfigKey {
    const val VALUE: String = "rck_test_REPLACE_WITH_YOUR_TEST_KEY"
}
