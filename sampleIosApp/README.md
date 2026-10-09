# iOS sample host

`sampleIosApp.xcodeproj` is committed and runs. Open it, or from the command line:

```bash
xcodebuild -project sampleIosApp.xcodeproj -scheme iosApp \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
```

The Gradle framework is built by a pre-build phase, so there is no separate step.

## How it is put together

`project.yml` is the source of truth; the `.xcodeproj` is generated from it with
[XcodeGen](https://github.com/yonaskolb/XcodeGen):

```bash
cd sampleIosApp && xcodegen generate
```

An earlier version of this file argued the project should NOT be committed, because an
`.xcodeproj` is "a generated binary-ish file with absolute paths and a project UUID, and
hand-writing one produces a file that opens and then fails in ways nobody can debug". The
objection is right about hand-writing one. Generating it answers both halves: `project.yml` is
the reviewable source, and every path in it is `$(SRCROOT)`-relative, so the committed project
carries nothing from the machine that produced it. The project is committed as well as the
spec so that evaluating this SDK does not begin with `brew install xcodegen`.

Three things were needed beyond the Swift files, and none of them are obvious from a build
that succeeds:

1. **`:sample` had to declare a binary framework.** `iosArm64()` on its own compiles Kotlin and
   produces a klib — which is why `:sample:compileKotlinIosSimulatorArm64` passed in CI for
   months with nothing an Xcode project could link against. `embedAndSignAppleFrameworkForXcode`
   is registered by the `binaries.framework { }` block, so without it the build phase that every
   integration guide tells you to add names a task that does not exist.

2. **`CADisableMinimumFrameDurationOnPhone` must be `true` in `Info.plist`.** Compose
   Multiplatform's `PlistSanityCheck` throws `kotlin.IllegalStateException` at first
   composition. The app builds clean, installs, launches, and dies on `SIGABRT` straight back to
   the home screen — a failure a compile-only check cannot see.

3. **The Compose view must NOT ignore the top safe area.** The CMP wizard emits
   `.ignoresSafeArea(.all)`, which is right for content that applies `WindowInsets.safeDrawing`
   itself. This sample applies no insets and the Android host sets no `enableEdgeToEdge`, so on
   Android the system insets the window; ignoring the safe area made iOS the one platform
   drawing its title underneath the Dynamic Island.

## The publishable key

`ContentView.swift` carries `rck_test_YPPmyI5wd7AO0y4lcbKXpPytOWCb0zwI`, the app's iOS **test**
key. Publishable keys are public — they ship inside every client bundle — so this belongs in
committed source. The secret is the account-level `rcp_` access token, which lives in the vault.

The test key rather than the live one because `attestation_policy` is `off` on test keys: a
simulator build cannot satisfy App Attest, and a live key would demand it.

Each host needs its own key. `app_key.platform` is a constraint, not a hint — `_shared/identity.ts`
answers a mismatch with 403 `platform_mismatch` — so the Android sample's key does not work here.

To issue a key for a platform an app does not have yet, use `issue_key` (migration 019), either
through the rconfig-mcp tool of that name or directly:

```bash
curl -s -X POST "$RCONFIG_FUNCTIONS_URL/v1-admin" \
  -H "Authorization: Bearer $RCONFIG_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"op":"issue_key","args":{"app_id":"<app id>","platform":"ios","environment":"test"}}'
```

A repeat call is refused and names the key that already exists, which is also how this host's key
was recovered: the app turned out to have had an iOS key since onboarding, and the placeholder in
this file — not a missing key — was the whole cause of `key_invalid`.
