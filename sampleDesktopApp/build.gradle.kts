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
    jvmToolchain(17)

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
