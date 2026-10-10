import SwiftUI
import sample

/// The publishable key — read from the SHARED Kotlin constant, not copied.
///
/// This file used to carry its own `rck_test_…` literal because the control plane minted a key
/// per platform, so iOS genuinely had a different key from Android. Migration 021 ended that: an
/// app now has one live key and one test key for every target.
///
/// So the key lives once, in `sample/src/commonMain/.../SampleKey.kt`, and the framework exposes
/// it here. That is the point worth seeing in a sample — a second copy would still be *correct*
/// while quietly teaching the thing that was just fixed.
private let publishableKey = SampleKeyKt.sampleKey

/// Hosts the Kotlin `ComposeUIViewController`.
///
/// `MainViewControllerKt.MainViewController(publishableKey:)` is the symbol the framework
/// actually exports — read from the generated `sample.h`, not assumed:
///
///     + (UIViewController *)MainViewControllerPublishableKey:(NSString *)publishableKey
///         __attribute__((swift_name("MainViewController(publishableKey:)")));
struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        MainViewControllerKt.MainViewController(publishableKey: publishableKey)
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}

struct ContentView: View {
    var body: some View {
        // NOT `.ignoresSafeArea(.all)`, which is what the Compose Multiplatform wizard emits.
        // That is right for an app whose Compose content applies `WindowInsets.safeDrawing`
        // itself; this sample's screen applies no insets at all, and the Android host sets no
        // `enableEdgeToEdge`, so on Android the system insets the window. Ignoring the safe area
        // here made iOS the one platform that drew its title underneath the Dynamic Island.
        //
        // The keyboard is still ignored: Compose moves focused content itself, and letting
        // SwiftUI also resize the controller makes the two fight over the same gap.
        ComposeView().ignoresSafeArea(.keyboard)
    }
}
