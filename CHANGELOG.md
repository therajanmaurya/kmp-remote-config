# Changelog

## Unreleased — epic rconfig-sdk-control-plane-migration

### Phase 01 · T2 — transport rewrite (breaking)

- `RemoteConfigService` now calls the control plane's `GET /v1-configs` and `POST /v1-events`
  over an INJECTED Ktor `HttpClient`, replacing the 3.5.28 implementation that built a Supabase
  client from a consumer-supplied url + anon key and read the `product_remote_config` table over
  PostgREST. That table is not what the control plane serves, so the dashboard could not reach
  any device — this is the defect the epic exists to fix.
- **Breaking:** `supabaseUrl` / `supabaseKey` are gone from the Koin DSL. A consumer now supplies
  `publishableKey`, `packageName`, `platform`, `appVersion`, an optional Android `certDigest`,
  and an `HttpClient`. `baseUrl` defaults to the hosted control plane.
- A fetch now returns a three-state `ConfigFetchResult`: `Success` (configs may legitimately be
  empty), `Rejected` (the server refused this caller — `key_invalid`, `package_mismatch`,
  `rate_limited`, …), or `Unavailable` (transport failure; keep serving cache). The old code
  caught every exception and returned `emptyList()`, so a revoked key and "nothing to show" were
  indistinguishable to an integrator.
- `X-RC-SDK-Version` is always sent and never blank: the server answers 403 `sdk_version_missing`
  rather than an empty set, so a missing header blacks out the whole product. The value resolves
  defensively — `cmpMetadata()` reaches into an external artifact and anything it throws would
  otherwise propagate out of every fetch.
- Error logs carry the exception CLASS only, never the message: a transport error can echo the
  URL, and the URL carries the publishable key's package context.
- `RemoteConfigEvaluator` got SMALLER on purpose. It no longer re-checks `is_enabled`, schedule,
  app-version window or platform — the control plane evaluates all four server-side, so a config
  that arrives has already matched. Two implementations of the same rules would drift, and the
  client's copy loses: it cannot see screens, cohorts or rollout buckets at all. What remains is
  what only the device knows — impression caps, dismissal, cooldown.
- `multiplatform-settings-no-arg` is now declared explicitly. It had been arriving transitively
  through supabase-postgrest, so removing the old transport broke an unrelated source set.

### Phase 01 · T3 — unknown displays are skipped, not mis-rendered

- `DisplayType.from()` returns `null` for an unrecognized `display` instead of falling back to
  `DIALOG`; `RemoteConfigHost` renders nothing. Closes two cases: `display: "none"` (a value-only
  feature flag could have shown a modal) and any presentation the control plane adds later, which
  reaches an older SDK as an unknown string. The client half of migration 010's display closure.
- `RemoteConfigHost` no longer routes to the server-driven-document renderer. `/v1/configs` serves
  `template` + `payload` and carries no `content_json`, so that branch had no data source. The
  public `DynamicUiRenderer` / `UiNodeParser` API is unchanged — a consumer holding its own
  `UiDocument` still renders it; the Host simply no longer has one to pass.
- New `ConfigContent` derives each presentation's strings and its primary action's destination
  from the opaque payload BY ROLE, with per-template defaults. Reading `payload.title` directly
  renders an empty overlay for most of the fifteen builtins — `update_available` has no title at
  all, which is why it now falls back to "Update available".

### Phase 01 · T4 — the contract test asserts the shipped model

- `ContractFixtureTest` now deserializes `contract/configs-response.json` into the production
  `RemoteConfigEnvelope`. It previously used private `WireEnvelope` / `WireConfig` classes that
  existed only inside that file, so a commit could change the wire shape and those two classes
  together, pass both halves of the contract test, and leave the real SDK reading something else.
  That is the drift that let the dashboard and the device disagree. The `slice-3` marker is gone.
- Every wire field is asserted BY VALUE, deliberately: the shipped model defaults each field so an
  older client tolerates a newer server, which means a renamed key deserializes silently into its
  default rather than throwing. Proven by mutation — renaming `template` to `templateId` fails both
  this test and the inlined-fixture drift check; restoring it passes.

### Phase 02 — the publish gate (migration 011)

- **Every edit used to be live on the next fetch.** `config` rows are now the DRAFT surface;
  `/v1/configs` serves the latest immutable snapshot from the new `config_version` table. Proven
  against the DEPLOYED function: an unpublished edit does not reach devices, and does after Publish.
- `publish(app)` snapshots the enabled drafts; `rollback_to(app, v)` publishes a NEW version
  carrying v's content and never deletes. Verified live: devices receive v1's payload again after
  a rollback, and the undone version stays in history.
- Snapshots EMBED the template contract (`renders_ui`, `requires_ack`, `min_sdk_version`), so
  editing a template cannot silently change what already-published configs do on devices. Schedule
  bounds are evaluated at FETCH time, so a config published today with a start of next Tuesday
  begins serving on Tuesday with no second publish.
- Immutability is a TRIGGER, not a REVOKE: a revoked privilege does not bind the table owner or
  `service_role`, which the edge functions use. UPDATE and DELETE are both refused, proven while
  running as superuser.
- **An app with published versions must stay deletable.** The cascade from `app` fires the
  append-only trigger, which aborted the whole DELETE and made every app with history permanently
  undeletable. The trigger now permits the cascade when the parent app is already gone. Found by
  the live e2e, whose sentinel cleanup silently stopped working.
- `service_role` may publish without a user session — not an escalation, since it already bypasses
  RLS and lives only in the vault; the alternative is every automated caller minting a user JWT.
- An app that has never published serves NOTHING. Fail-closed on purpose: falling back to drafts
  would reinstate this exact gap, silently, on the apps nobody has reviewed yet.
- G-10 holds: 0 anon-callable routines, explicit ACLs, no empty grantee.
- Dashboard: `/apps/[id]/publish` (staged diff, old → new, new/modified/removed) and
  `/apps/[id]/history` (versions, Live badge, forward-only rollback), with a persistent
  unpublished-changes pill in new `[id]/layout.tsx` chrome — on every app route, because a warning
  you only see once you go looking warns nobody. Deployed; interactive spec written but NOT run
  (see below).

### Phase 01 · T6 — 5.0.0 prepared, NOT published

- `gradle.properties#kmpremoteconfig.version` → `5.0.0`; release notes at `docs/releases/5.0.0.md`
  covering the transport change and the removal of `supabaseUrl` / `supabaseKey`.
- **Nothing published.** Two gates are open: repo invariant 6 (KmpToolkit still publishes these
  two coordinates) and epic gate G-11 (no operator has driven the dashboard end to end — the
  deployed plane holds 15 builtin templates and zero apps, keys or configs).
- Canary `tests/fixtures/sdk-control-plane-canary/` locks G-1: the legacy-transport grep fails on
  a red fixture carrying the 3.5.28 PostgREST service and passes on the migrated one. The green
  fixture names the legacy symbols inside a comment on purpose — it proves the predicate reads
  code rather than text, which is the half most easily broken by "fixing" a noisy gate.

### Phase 01 · T5 — live SDK contract check

- Added `supabase/tests/e2e_sdk_contract.sh`: seeds a sentinel app + test key + config on the
  DEPLOYED project, fetches through the real `/v1-configs` edge function with the same headers
  `RemoteConfigService` sends, parses the captured body with the production `RemoteConfigEnvelope`
  under a strict reader, then removes the sentinel (cascade from the app row). Idempotent, zero
  residue. Wired into `control-plane.yml` as the `live-sdk-contract` job on `dev` + manual.
- This is the first check in the project's history that proves the SDK's model against the LIVE
  plane rather than against a committed fixture. A local stack is built from the same migrations
  the fixture reflects, so a migration applied to prod and never committed is invisible to every
  other suite.
- `LiveWireParseTest` (jvmTest) does the parsing. It SKIPS when `-Drc.live.body` is absent, so
  `allTests` stays runnable with no network and no credentials.

### Phase 01 · T1 — shipped wire model (breaking)

- Added `RemoteConfigEnvelope` / `RemoteConfigItem` in `cmp-remote-config`: the SHIPPED model
  for `GET /v1/configs` — `schema_version` + `configs[]`, each carrying `template`, an opaque
  `payload` JsonObject, and `display`.
- The payload stays an opaque object rather than flattened named fields. Flattening is what
  limited the previous model to announcement-shaped configs: `update_available` carries
  store_url / forced / release_notes / current_version and has no title or body, so any fixed
  field set is wrong for most of the fifteen templates.
- Server-side targeting (platform, app-version window, screens, schedule) is deliberately
  absent from the wire item — by the time a config reaches a device it has already matched,
  and shipping the predicates would invite a second, divergent evaluation on the client.
- `RemoteConfigEnvelopeTest` asserts the real `contract/configs-response.json` against these
  production types, including forward-compatibility with an unknown server field.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **History before this file:** `cmp-remote-config` and `cmp-remote-config-compose` lived in
> [KmpToolkit](https://github.com/MobileByteLabs/KmpToolkit) through `3.5.28`. Entries for every
> release up to and including that version are in
> [KmpToolkit's CHANGELOG](https://github.com/MobileByteLabs/KmpToolkit/blob/dev/CHANGELOG.md).
> This file starts at the split.

---

## [Unreleased] — `4.0.0-alpha02`

### Changed — publishing is gated; cron releases removed

`publish-trigger.yml` fired on every push to `dev` matching `cmp-*/**`, and `publish.yml` carried two
cron schedules. It now dispatches only from a push to the **`release`** branch or a manual
`workflow_dispatch`, and the crons are gone. Also fixed in the same pass:

- `artifact-id` was `cmp-bubble` — a module this repo does not contain — so the "fail if Maven is
  ahead" guard compared our version against an unrelated artifact and could never catch a real
  collision. Now `cmp-remote-config`.
- `publish-gradle-plugin-portal: true` → `false`. No module here declares a `gradlePlugin` block
  (`cmp-firebase-gradle-plugin` stayed in KmpToolkit), so the job reported success having published
  nothing — a false green on the release summary.
- `bump-after-release: true` → `false`. `next-bump-type: 'patch'` turned `4.0.0-alpha01` into
  `4.0.1`, dropping the prerelease suffix and silently promoting the alpha line to a release line.
  Suffixes are now chosen by hand.
- The version path filter now includes `gradle.properties`. It previously did not, so a release
  commit that ONLY bumped the version would not have triggered — the inverse bug.

`SONATYPE_AUTOMATIC_RELEASE` stays `true`: a release is hands-off once it reaches `release`, so the
trigger is the only gate.

---

## [4.0.0-alpha01] — 2026-10-05 — released unintentionally

Published to Maven Central by accident. The genesis commit's push to `dev` matched
`publish-trigger.yml`'s then-current `cmp-*/**` path filter, which dispatched `publish.yml`;
org-level publishing secrets resolved via `secrets: inherit`, and `SONATYPE_AUTOMATIC_RELEASE=true`
closed and released the staging repository with no human gate. Maven Central does not permit
deletion, so the release is permanent.

**What it contains:** the functional KmpToolkit `3.5.28` code at a 4.x version number. The reworked
API the 4.x line is reserved for — publishable keys, attestation, `screen` scoping, the template
registry — is **not** in it. `remoteConfig { }` still requires `supabaseUrl` + `supabaseKey`, and
`RemoteConfigHost` still takes no `screen` parameter.

**If you depended on it:** prefer `3.5.x` from KmpToolkit for now, or pin `4.0.0-alpha01` knowingly.
It is not broken — it is mislabelled.

Tag `v4.0.0-alpha01` and its GitHub release were created by the same run.

### Added — repo split from KmpToolkit

Remote config moved to its own repo because it grew a server and an operator dashboard, which do not
belong in a general-purpose library collection. The repo carries three pieces as one product: the
SDK (`cmp-remote-config` + `cmp-remote-config-compose`), the backend (`supabase/`) and the dashboard
(`dashboard/`).

Carried over unchanged from KmpToolkit: the Gradle publishing pipeline, Dokka/Kover convention
plugins, detekt + Spotless config, the mkdocs site, and the CI workflows.

### Changed

- **Artifact coordinates are unchanged** — `io.github.mobilebytelabs:cmp-remote-config` and
  `…:cmp-remote-config-compose`. A consumer migrates a *version*, not a dependency id.
- `cmp-observe` is now an **external dependency** (`io.github.mobilebytelabs:cmp-observe:3.5.31`)
  rather than a sibling module. It stays published from KmpToolkit; vendoring a second copy would
  drift.
- Single version source renamed `kmptoolkit.version` → `kmpremoteconfig.version`.
- Convention plugin ids renamed `io.github.mobilebytelabs.kmptoolkit.{dokka,kover}` →
  `io.github.mobilebytelabs.remoteconfig.{dokka,kover}`.
- Default branch is `dev`; there is no `main`.

### Fixed — two defects inherited from KmpToolkit

- **`CmpMetadata.VERSION` was always `"UNKNOWN"`.** `cmp-observe-metadata.gradle.kts` is applied
  from each module's `build.gradle.kts`, so its `apply(from = CMP_LIBRARY_METADATA.gradle.kts)` ran
  in the *module's* context and populated the module's `extra` — but the lookup read
  `rootProject.extra`, which never had the keys, so every module fell through to the `"UNKNOWN"`
  fallback. The symptom was visible in `cmp-remote-config/DEVELOPMENT.md` (`version: UNKNOWN`) but
  read as "not published yet". Now reads `extra` first, with `rootProject.extra` as fallback.
  **Still present in KmpToolkit for all its modules.**
- **`cmp-remote-config`'s Android namespace was `com.mobilebytesensei.featurerequest`** — a
  copy-paste from cmp-product-tickets. Corrected to `com.mobilebytelabs.remoteconfig`.
- `CMP_LIBRARY_METADATA.gradle.kts` had no `cmp_remote_config_compose_version` key at all; both
  modules now declare both keys.

### Not yet implemented

The product this split exists for — a hosted control plane, publishable keys bound by platform
attestation (Play Integrity / App Attest), screen-scoped targeting, a server-side template registry
(`update_available`, `notification`, …) and the operator dashboard — is **not in this release**. The
SDK still behaves as it did at `3.5.28`: `remoteConfig { supabaseUrl; supabaseKey }` talks directly
to a consumer-supplied Supabase project with an anon key.

`4.0.0` is reserved as a major because that entry point becomes a single `publishableKey`.

### Coordinate ownership — still open

This was written as a precondition to be met *before* the first publish from here. The accidental
`4.0.0-alpha01` release overtook it, so it is now an open item rather than a gate:

KmpToolkit should **drop** `cmp-remote-config` and `cmp-remote-config-compose`. Until it does, both
repos can publish the same coordinates. Nothing errors — KmpToolkit releases `3.5.x`, this repo owns
`4.x`, and Central accepts both — but the version history for those artifacts interleaves across two
sources, and the two could collide the moment KmpToolkit's line reaches `4.0.0`.
