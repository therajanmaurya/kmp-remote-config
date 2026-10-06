# kmp-remote-config — Claude Context

Repo context for `/lib-sync` and `/sync-remote-config`.

This repo was split out of [KmpToolkit](https://github.com/MobileByteLabs/KmpToolkit) at `3.5.28`.
It publishes exactly two artifacts and carries the backend + dashboard that drive them.

## Repo shape

| Path | What |
|---|---|
| `cmp-remote-config/` | Headless SDK — fetch, evaluate, UI-document model |
| `cmp-remote-config-compose/` | Compose surface — `RemoteConfigHost`, presentations, Koin DSL |
| `supabase/` | Backend — schema (`migrations/`) + Edge Functions (`functions/`) |
| `dashboard/` | Operator UI — Next.js 14 App Router on Cloudflare Pages (cloned from PayCraft's stack) |
| `build-logic/` | Dokka + Kover convention plugins (`io.github.mobilebytelabs.remoteconfig.*`) |

## Invariants

1. **`cmp-observe` is an EXTERNAL dependency**, not a module here. It stays published from
   KmpToolkit and is consumed via `libs.cmp.observe`. Never vendor a copy — that is the drift this
   split exists to avoid.
2. **Artifact coordinates are frozen** at `io.github.mobilebytelabs:cmp-remote-config[-compose]`.
   Consumers migrate a version, not a dependency id. Do not rename them.
3. **`CMP_LIBRARY_METADATA.gradle.kts` lists only modules that exist.** The generator in
   `cmp-observe-metadata.gradle.kts` looks keys up with `as String`; a stale key silently stamps a
   wrong artifact id onto telemetry. Add a row only when `settings.gradle.kts` gains an `include`.
4. **One version source** — `gradle.properties#kmpremoteconfig.version`. Both modules read it.
5. **Default branch is `dev`.** Every workflow triggers on `dev`; there is no `main`.
6. **No publish from this repo until KmpToolkit stops publishing these two artifacts.** Otherwise
   two repos race the same Maven coordinate. **Still holds at the 5.0.0 line**: `gradle.properties`
   now reads `5.0.0` and `docs/releases/5.0.0.md` is authored, but nothing is published. A second
   gate also applies — epic gate G-11, the operator walkthrough: as of 2026-10-07 the deployed
   plane has 15 builtin templates and zero apps, keys or configs, so no human has driven the
   dashboard end to end.

## cmp-remote-config

```yaml
artifact: io.github.mobilebytelabs:cmp-remote-config
version:  5.0.0 (prepared, unpublished — see invariant 6)
package:  com.mobilebytelabs.remoteconfig
targets:  15 (headless — Android, iOS, macOS, watchOS, tvOS, JVM, JS, wasmJs, linuxX64, mingwX64)
backend:  supabase (migrating to this repo's own control plane — see below)
di:       koin — `Module.remoteConfig { }` DSL in the -compose module
```

### Key APIs

| API | Purpose |
|---|---|
| `RemoteConfigEnvelope` / `RemoteConfigItem` | **The shipped wire model** for `GET /v1/configs` — `template` + opaque `payload` + `display`. Replaces the flat 3.5.28 shape |
| `RemoteConfigService` | Fetch active configs, record impressions, dismiss |
| `RemoteConfigEvaluator` | Decide whether a config applies to this device / app / version |
| `RemoteConfig` / `DisplayType` | A delivered config and how it presents |
| `UiDocument` / `UiNode` / `UiAction` | Server-driven UI tree |
| `UiNodeParser` | Parses a document; emits `UiNode.Unknown` rather than throwing |
| `RemoteConfigLocalStore` / `DeviceIdProvider` | Local persistence |
| `ActionHandler` / `ActionContext` | Dispatch a `UiAction` |

## cmp-remote-config-compose

```yaml
artifact: io.github.mobilebytelabs:cmp-remote-config-compose
version:  5.0.0 (prepared, unpublished — see invariant 6)
package:  com.mobilebytelabs.remoteconfig (android namespace: …remoteconfig.compose)
targets:  7 (Compose-MP only — iosX64/macosX64 absent: Compose 1.12.0 publishes no artifact)
```

| API | Purpose |
|---|---|
| `RemoteConfigHost` | Renders the active config; `onAction` escape hatch |
| `DynamicUiRenderer` | Renders a `UiNode` tree |
| `RemoteConfigDialog` / `BottomSheet` / `Banner` / `FullScreen` | Presentations |
| `RemoteConfigViewModel` | State holder |
| `Module.remoteConfig { }` | Koin install + `action(...)` handler registration |

## Known inherited defects

- **`android.namespace` was `com.mobilebytesensei.featurerequest`** on `cmp-remote-config` — a
  copy-paste from cmp-product-tickets. Fixed here to `com.mobilebytelabs.remoteconfig`.
- **`CmpMetadata.VERSION` was always `"UNKNOWN"`.** `cmp-observe-metadata.gradle.kts` applied
  `CMP_LIBRARY_METADATA.gradle.kts` in the *module's* context (setting the module's `extra`) but read
  `rootProject.extra`, so the lookup always threw into the fallback. Fixed here; **still present in
  KmpToolkit** for all its modules.
- The compose module had no `_version` key in `CMP_LIBRARY_METADATA.gradle.kts` at all.

## Not yet built

The control plane, the 15-template registry, publishable keys and the operator dashboard are
BUILT and deployed (`supabase/DEPLOY.md`). As of 2026-10-07 the **SDK transport is migrated** —
it calls `/v1-configs` and `/v1-events` with the publishable-key header tuple, verified against
the deployed plane by `supabase/tests/e2e_sdk_contract.sh`.

Still open: publish/versioning, typed parameters + named conditions, in-app defaults, staged
rollout, the remaining dashboard surfaces, and the marketing site — tracked as phases 02–07 of
the `rconfig-sdk-control-plane-migration` epic in the framework plan layer. Play Integrity /
App Attest remain specified but unbuilt (`/v1/attest` has nothing behind it — see DEPLOY.md).

**The dashboard has never been driven end to end by a human.** The deployed plane holds 15
builtin templates from migration 004 and zero apps, keys or configs. That walkthrough is epic
gate G-11 and it gates publishing.
