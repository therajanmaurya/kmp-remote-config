# iOS app shell

The Kotlin side is done: `sample/src/iosMain/.../MainViewController.kt` exposes

```kotlin
fun MainViewController(publishableKey: String) = ComposeUIViewController { … }
```

which is exactly what the Kotlin Multiplatform wizard generates. What is missing is the Xcode
project that calls it, and that is deliberate: an `.xcodeproj` is a generated binary-ish file
with absolute paths and a project UUID, and hand-writing one produces a file that opens and
then fails in ways nobody can debug.

To add it, in Xcode create an iOS App target in this directory and wire two files:

`iOSApp.swift`
```swift
import SwiftUI

@main
struct iOSApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}
```

`ContentView.swift`
```swift
import SwiftUI
import sample   // the Kotlin framework produced by :sample

struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        // A test key: it skips attestation, which App Attest would otherwise refuse for a
        // development build.
        MainViewControllerKt.MainViewController(publishableKey: "rck_test_…")
    }
    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}

struct ContentView: View {
    var body: some View { ComposeView().ignoresSafeArea(.all) }
}
```

Then add a Run Script build phase ahead of "Compile Sources":

```
cd "$SRCROOT/.."
./gradlew :sample:embedAndSignAppleFrameworkForXcode
```

The Kotlin half is verified — `:sample:compileKotlinIosSimulatorArm64` passes in CI. The Xcode
project is not, and saying so is better than committing a generated file nobody has opened.
