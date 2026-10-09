plugins {
    // No `org.jetbrains.kotlin.android`: AGP 9.0 applies Kotlin itself and the separate plugin
    // now fails the build outright. The KMP wizard's template still lists it because it targets
    // an older AGP.
    alias(libs.plugins.android.application)
    alias(libs.plugins.composeCompiler)
}

// The Android shell around the shared `App()`, as the KMP wizard lays it out: an application
// module that depends on the shared module and owns nothing but the Activity.
android {
    namespace = "com.mobilebytesensei.rconfig.android"
    compileSdk = libs.versions.android.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "com.mobilebytesensei.rconfig"
        minSdk = libs.versions.android.minSdk.get().toInt()
        targetSdk = libs.versions.android.compileSdk.get().toInt()
        versionCode = 1
        versionName = "1.0.0"
    }
    buildTypes { getByName("release") { isMinifyEnabled = false } }
    compileOptions {
        // Must match the Kotlin jvmTarget of the modules this app consumes, or AGP fails
        // the build with a source/target mismatch rather than a useful message.
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
}

dependencies {
    implementation(project(":sample"))
    implementation(libs.androidx.activity.compose)
    implementation(libs.ktor.client.okhttp)
}
