import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

// The web shell, wasmJs only — matching `cmp-remote-config-compose`, which publishes a wasmJs
// target and no JS one for Compose.
kotlin {
    @OptIn(ExperimentalWasmDsl::class)
    wasmJs {
        browser()
        binaries.executable()
    }

    sourceSets {
        wasmJsMain.dependencies {
            implementation(project(":sample"))
            // ComposeViewport lives in compose.ui — depending on the shared module alone gives
            // the app but not the host that mounts it.
            implementation(compose.ui)
            implementation(compose.runtime)
            implementation(libs.ktor.client.js)
        }
    }
}
