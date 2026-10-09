import SwiftUI
import sample

/// The publishable key for this host.
///
/// Publishable keys are PUBLIC — they ship inside every client bundle, so this belongs in
/// committed source. The secret credential is the account-level access token (`rcp_…`), which
/// lives in the vault and never appears here.
///
/// Each host carries its OWN key because `app_key.platform` is a constraint, not a hint:
/// `_shared/identity.ts` answers a platform mismatch with 403 `platform_mismatch`. The Android
/// sample's key would not work here even though both hosts are the same product.
///
/// This is the `test` key, which is what a debug build wants: `attestation_policy` is `off` on
/// test keys, so App Attest is not demanded of a simulator build that could never satisfy it.
private let publishableKey = "rck_test_YPPmyI5wd7AO0y4lcbKXpPytOWCb0zwI"

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
