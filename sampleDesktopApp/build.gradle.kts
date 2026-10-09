import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

// The desktop shell. A separate module from `:sample` because an app and a library have
// different jobs — the wizard splits them for the same reason.
kotlin {
    jvm()
    // 21, not 17: the desktop app loads cmp-observe / cmp-open-url, which are published at
    // Java 21. A 17 toolchain reproduces exactly the UnsupportedClassVersionError this change
    // exists to remove.
    jvmToolchain(21)

    sourceSets {
        jvmMain.dependencies {
            implementation(project(":sample"))
            implementation(compose.desktop.currentOs)
            implementation(libs.ktor.client.cio)
        }
    }
}

compose.desktop {
    application {
        mainClass = "com.mobilebytesensei.rconfig.MainKt"
        nativeDistributions {
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
            packageName = "rconfig-sample"
            packageVersion = "1.0.0"
        }
    }
}
