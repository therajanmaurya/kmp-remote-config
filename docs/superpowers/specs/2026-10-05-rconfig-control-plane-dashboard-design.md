# Design — remote-config control plane + operator dashboard

> **Slices 1 + 2 of 5.** Status: awaiting review. Author: Claude (Opus 5) with Rajan Maurya.
> Date: 2026-10-05. Project: `mbs/kmp-remote-config`.

---

## 1. Scope

**In scope — slice 1 (control plane) + slice 2 (dashboard MVP):**

- Supabase schema: users → apps → keys, templates, configs, impressions.
- Google sign-in, multi-tenancy, row-level security.
- Three Edge Function routes the SDK calls.
- A server-side template registry with a JSON-Schema payload per config type.
- Operator dashboard at `rconfig.mobilebytesensei.com`: sign in, add N apps, issue keys,
  author a config from a template form, schedule and target it.

**Explicitly out of scope** (each is its own spec):

| Slice | Why not here |
|:-:|---|
| 3 — SDK rework (`publishableKey`, `screen` filter, template renderers, attestation client) | Needs this wire contract fixed first. Until it lands, the dashboard controls nothing a real app reads. |
| 4 — visual UI editor | Needs 1–3 to have a target. |
| 5 — community templates + free/paid tiers | Needs 4 to have templates worth sharing. Carries an unresolved consent question (§15). |

The schema here must *accommodate* slices 3–5 without being rewritten, so §5 reserves the columns
they need. It does not implement them.

### What this spec changes about today's behaviour

Nothing in the shipped SDK. `cmp-remote-config` 4.0.0-alpha01 on Maven Central still talks directly
to a consumer-supplied Supabase project with an anon key. That changes in slice 3.

---

## 2. Problem

Three independent problems, one cause: there is no control plane.

**2.1 The library and its only consumer are incompatible in production.** Two schemas exist:

| Schema | Where | Read path |
|---|---|---|
| `product_remote_config` | what `RemoteConfigService` queries | anon key, direct PostgREST |
| `app_remote_config` | deployed in `mbs/reels-downloader` | `service_role`, via a `/config` Edge Function |

`reels-downloader`'s migration `013_rls_hardening.sql` ran `REVOKE USAGE ON SCHEMA public FROM anon`,
so the SDK's anon-PostgREST read path **cannot reach the deployed table at all**. The symptom is
silent: `getActiveConfigs()` catches everything and returns `emptyList()`, which is indistinguishable
from "no configs".

**2.2 There is no app identity.** The anon key *is* the credential. Every consuming app must be
granted anon read on its own table, so "which app is asking" cannot be answered, and neither can
"should this app be allowed to ask".

**2.3 Authoring is SQL.** No dashboard, no validation, no named config types. "Update available"
exists only as hand-set column values, so an operator can author a row the client cannot render and
find out from a user.

---

## 3. Decisions already taken

Recorded with rationale so later work can trace them rather than re-litigate.

| # | Decision | Rationale |
|:-:|---|---|
| D1 | **One central control plane**, MBS-hosted | A single dashboard across all apps is only possible if the server owns the key registry. New app = issue a key, not a migration. |
| D2 | **Platform attestation** (Play Integrity / App Attest) on top of publishable keys | A signing SHA is public and client-asserted, so key+SHA alone is an abuse control, not a boundary. Attestation is a real one. |
| D3 | **Templates first**, free-form `UiNode` tree as escape hatch | Dashboard becomes a form per template; renders in the app's own `MaterialTheme`; bounded surface is versionable and testable. |
| D4 | **One repo** holds backend + dashboard + SDK | The wire contract cannot drift from the model when both change in one commit — enforced by a shared fixture (§13.4). |
| D5 | Artifact coordinates stay `io.github.mobilebytelabs:cmp-remote-config[-compose]` | A consumer migrates a version, not a dependency id. |
| D6 | **Dedicated Supabase project** for this product | Operator-supplied 2026-10-05; aliases `kmp-remote-config-supabase-*` are in the vault. Isolation from `framework-supabase` (which backs the PayCraft dashboard). |
| D7 | Publishing gated on the **`release`** branch; no cron | A push to `dev` published `4.0.0-alpha01` to Maven Central unattended. Central never deletes. |
| D8 | **Dashboard clones the PayCraft dashboard pattern** | It already does Google sign-in, Supabase SSR, and Cloudflare Pages deploy in production at `paycraft.mobilebytesensei.com`. Reuse the stack and its hard-won auth fixes. |

---

## 4. Architecture

```
                        ┌──────────────────────────────────┐
  operator ─ Google ───►│ rconfig.mobilebytesensei.com     │
             sign-in    │ Next.js 14 on Cloudflare Pages   │
                        │  · browser: anon key + RLS       │
                        │  · server:  service_role         │
                        └───────────────┬──────────────────┘
                                        │ authenticated, RLS-scoped
                                        ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │ Supabase (dedicated project)                                      │
   │                                                                   │
   │   auth.users ──owns──► app ──► app_key                            │
   │                         │                                         │
   │                         ├────► config ──► template                │
   │                         └────► impression                         │
   │                                                                   │
   │   RLS ON for every table. anon REVOKED on schema public.          │
   │                                                                   │
   │   Edge Functions (service_role — bypass RLS):                     │
   │     GET  /v1/configs?screen=…   audience-evaluated, edge-cached   │
   │     POST /v1/events             attestation required              │
   │     POST /v1/attest             Play Integrity / App Attest       │
   └────────────────────────────────▲───────────────────────────────────┘
                                    │  X-RC-Key + package + cert + versions
                                    │  (slice 3 — not yet implemented)
   ┌────────────────────────────────┴───────────────────────────────────┐
   │ consumer app                                                       │
   │   cmp-remote-config          fetch · frequency · UI document        │
   │   cmp-remote-config-compose  RemoteConfigHost(screen = "home")      │
   └────────────────────────────────────────────────────────────────────┘
```

Two distinct trust paths into one database, and keeping them distinct is the core security property:

- **Dashboard** → the signed-in user's JWT → RLS decides what they can see. A dashboard bug cannot
  read another tenant's data, because the database refuses.
- **SDK** → Edge Function → `service_role` → RLS bypassed, so the *function* is the authorization
  boundary and must scope every query by the app resolved from the presented key.

---

## 5. Data model

PostgreSQL in the dedicated Supabase project. All tables in `public`, all with RLS enabled and
forced, `anon` and `authenticated` revoked at the schema level (the `reels-downloader`
`013_rls_hardening.sql` posture) so a missed policy fails closed rather than open.

### 5.1 `app`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `owner_id` | `uuid NOT NULL` | → `auth.users(id)` ON DELETE CASCADE |
| `slug` | `text NOT NULL` | unique per owner; URL-safe |
| `display_name` | `text NOT NULL` | |
| `platforms` | `text[] NOT NULL DEFAULT '{}'` | advisory; informs the dashboard's key form |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` | `updated_at` via trigger |

`UNIQUE (owner_id, slug)`. "N apps per user" is just rows here — no quota in slices 1–2 (quotas are
slice 5).

### 5.2 `app_member`

| Column | Type | Notes |
|---|---|---|
| `app_id` | `uuid` | → `app(id)` ON DELETE CASCADE |
| `user_id` | `uuid` | → `auth.users(id)` ON DELETE CASCADE |
| `role` | `text NOT NULL DEFAULT 'owner'` | `owner` \| `editor` \| `viewer` |

PK `(app_id, user_id)`. **Exists in slice 1 with no dashboard UI.** Reason: every RLS policy is
written against membership rather than `owner_id`, so adding teams later is a UI change, not a
migration that rewrites every policy. A trigger inserts the `owner` row when an `app` is created.

### 5.3 `app_key`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `app_id` | `uuid NOT NULL` | → `app(id)` ON DELETE CASCADE |
| `key` | `text NOT NULL UNIQUE` | `pk_live_…` / `pk_test_…`, 32 bytes base62 |
| `label` | `text` | operator's note, e.g. "Android production" |
| `environment` | `text NOT NULL` | `live` \| `test` |
| `platform` | `text` | `android` \| `ios` \| `desktop` \| `web` \| `wasm` \| null = any |
| `bundle_id` | `text` | package name / bundle id the client must assert |
| `cert_digests` | `text[] NOT NULL DEFAULT '{}'` | accepted signing-certificate **SHA-256** digests |
| `attestation_policy` | `text NOT NULL DEFAULT 'preferred'` | `required` \| `preferred` \| `off` |
| `rate_limit_per_min` | `int NOT NULL DEFAULT 60` | per key |
| `revoked_at` | `timestamptz` | null = active |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

**`key` is stored in plaintext, deliberately.** A publishable key ships inside the client binary;
anyone can extract it. Hashing it would prevent the dashboard from showing a developer the key their
own app already contains, while protecting nothing. The access control that matters is `bundle_id` +
`cert_digests` + attestation, not the key's secrecy. (Contrast the `service_role` key, which is a
real secret and lives only in the vault.)

**`cert_digests` is an array of SHA-256, not one SHA-1.** Play App Signing *re-signs* the upload
artifact, so the digest a developer reads locally is frequently not the shipping one; Play Integrity
reports SHA-256. A single-value SHA-1 column breaks on the first upload-key rotation. The dashboard
accepts a SHA-1 on input and normalizes, but stores the set.

### 5.4 `template`

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | `announcement`, `update_available`, … (§9) |
| `version` | `int NOT NULL DEFAULT 1` | bump on a payload-schema change |
| `display_name` | `text NOT NULL` | dashboard label |
| `description` | `text` | one line, shown in the picker |
| `payload_schema` | `jsonb NOT NULL` | JSON Schema; drives the form AND write validation |
| `allowed_displays` | `text[] NOT NULL` | subset of dialog/bottom_sheet/banner/fullscreen/inline/none |
| `min_sdk_version` | `text NOT NULL` | lowest SDK that can render it |
| `requires_ack` | `boolean NOT NULL DEFAULT false` | true ⇒ dismissal is not enough (§9) |
| `renders_ui` | `boolean NOT NULL DEFAULT true` | false for `feature_flag` |
| `is_builtin` | `boolean NOT NULL DEFAULT true` | false reserved for slice 4/5 user templates |
| `app_id` | `uuid` | null = global built-in; set = app-private (slice 4) |

`min_sdk_version` is the mechanism that structurally removes the blank-surface class. Today
`UiNodeParser` substitutes `UiNode.Unknown` so an unknown node cannot blank a screen — a mitigation.
Here the server simply **does not send** a template the calling SDK cannot render, so the client never
has to degrade.

### 5.5 `config`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `app_id` | `uuid NOT NULL` | → `app(id)` ON DELETE CASCADE |
| `template_id` | `text NOT NULL` | → `template(id)` |
| `payload` | `jsonb NOT NULL` | validated against `template.payload_schema` on write |
| `display` | `text NOT NULL` | must be in `template.allowed_displays` |
| `screens` | `text[] NOT NULL DEFAULT '{}'` | **empty = every screen** |
| `platforms` | `text[] NOT NULL DEFAULT '{}'` | empty = every platform |
| `min_app_version` / `max_app_version` | `text` | inclusive, optional |
| `locale` | `text` | reserved; null = any. Per-locale payloads are slice 4+ |
| `priority` | `int NOT NULL DEFAULT 0` | higher wins |
| `is_enabled` | `boolean NOT NULL DEFAULT false` | **defaults false** so a half-written config cannot ship |
| `starts_at` / `ends_at` | `timestamptz` | null = immediate / no expiry |
| `max_impressions` | `int NOT NULL DEFAULT 1` | 0 = unlimited |
| `cooldown_hours` | `int NOT NULL DEFAULT 24` | 0 = no cooldown |
| `is_dismissible` | `boolean NOT NULL DEFAULT true` | |
| `version` | `int NOT NULL DEFAULT 1` | bump to re-show within a cap window |
| `created_at` / `updated_at` | `timestamptz` | trigger on update |

`is_enabled DEFAULT false` is a deliberate inversion of the current table (`DEFAULT TRUE`): authoring
in a dashboard means a row exists while it is still being written, and a default-on row is live the
moment it is inserted.

`screens` as an array with empty-means-all keeps the common case (app-wide announcement) a zero-effort
author action while making per-screen targeting (CR-011) a first-class filter.

### 5.6 `impression`

| Column | Type | Notes |
|---|---|---|
| `config_id` | `uuid` | → `config(id)` ON DELETE CASCADE |
| `device_id` | `text` | client-generated, opaque |
| `app_id` | `uuid NOT NULL` | denormalized for rate-limit and cleanup queries |
| `count` | `int NOT NULL DEFAULT 0` | |
| `dismissed` | `boolean NOT NULL DEFAULT false` | |
| `acked_at` | `timestamptz` | for `requires_ack` templates |
| `acted_at` | `timestamptz` | CTA tapped |
| `seen_event_ids` | `text[] NOT NULL DEFAULT '{}'` | last N client event ids, for retry dedupe (§8.2) |
| `first_seen_at` / `last_seen_at` | `timestamptz NOT NULL DEFAULT now()` | |

PK `(config_id, device_id)`. Written **only** by the `/v1/events` Edge Function under
`service_role`; no policy grants the browser or the SDK write access. The dashboard reads aggregates
through a view, never per-device rows.

`device_id` is a stable pseudonymous identifier. It is never logged, never included in telemetry, and
is not joined to `auth.users`.

### 5.7 RLS policies

Every policy resolves through `app_member`, never `owner_id`:

```sql
create or replace function public.is_app_member(p_app uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from public.app_member
    where app_id = p_app and user_id = auth.uid()
  );
$$;
```

| Table | `select` | `insert` / `update` / `delete` |
|---|---|---|
| `app` | `is_app_member(id)` | insert: `owner_id = auth.uid()`; update/delete: `is_app_member(id)` and role `owner` |
| `app_member` | `is_app_member(app_id)` | role `owner` only |
| `app_key` | `is_app_member(app_id)` | `is_app_member(app_id)` |
| `config` | `is_app_member(app_id)` | `is_app_member(app_id)` and role in (`owner`,`editor`) |
| `template` | `app_id is null or is_app_member(app_id)` | built-ins: none (migration-only) |
| `impression` | **no policy** | **no policy** — service_role only |

`security definer` on `is_app_member` is required (the policy on `app_member` would otherwise recurse)
and is safe because the function takes only an app id and reads only membership.

---

## 6. Authentication and tenancy

**Google sign-in via Supabase Auth**, already configured by the operator. The dashboard calls
`supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: origin + "/auth/callback" } })`.

Copied verbatim from the PayCraft dashboard, including its stale-state handling: a leftover
`sb-<ref>-auth-token-flow-<hash>-code-verifier` cookie makes GoTrue reject the next sign-in with an
opaque 400, so the login page purges stale Supabase auth artifacts before each attempt and again on
error. This is not defensive clutter — it is a bug that reproduces whenever a user abandons a login
in one tab and retries in another.

Required Google console configuration (operator-side, done):
- Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
- Authorized JS origins: `https://rconfig.mobilebytesensei.com` **and** `http://localhost:3000`

Omitting the localhost origin breaks local development only, with an opaque error — worth asserting in
the setup checklist rather than rediscovering.

**No Google client secret reaches this repo.** Supabase holds it and performs the code exchange
server-side. The dashboard needs only the project URL and anon key.

**Tenancy:** a user signs in, creates apps, and sees exactly the apps they are a member of. There is
no org/team layer in slices 1–2; `app_member` makes adding one a UI change.

---

## 7. Key model and attestation

### 7.1 What is actually protected

| Asset | Threat | Control |
|---|---|---|
| Config **content** | — | None needed. It is rendered to users; it is not secret. |
| Dashboard **writes** | Someone changes what apps show | Google sign-in + RLS |
| **Event writes** | Poisoned impression data, fake dismissals | Attestation + per-key rate limit |
| **Quota / cost** | Someone hammers the Edge Function | Rate limit per key and per device |

This table is the justification for §7.3's asymmetry. Treating config content as a secret would cost
the edge cache and buy nothing.

### 7.2 Request identity

Every SDK request carries:

| Header | Purpose |
|---|---|
| `X-RC-Key` | the publishable key → resolves the app |
| `X-RC-Package` | package name / bundle id → must match `app_key.bundle_id` |
| `X-RC-Cert` | signing cert SHA-256 → must be in `app_key.cert_digests` (Android only) |
| `X-RC-Platform` | android / ios / desktop / web / wasm |
| `X-RC-App-Version` | consumer app version name |
| `X-RC-SDK-Version` | SDK version → gates templates by `min_sdk_version` |
| `X-RC-Device` | opaque device id (events only) |
| `X-RC-Attestation` | platform assertion from `/v1/attest` (events; reads when `required`) |

A mismatch on package or cert is a `403`, not an empty result — a misconfigured key should be loud
at integration time, not silent in production.

### 7.3 Attestation placement

**Policy-driven on both routes, default `preferred`. Writes additionally reject `off`.**

> **Amended 2026-10-05 (review finding I8).** This section previously read "Required on
> `/v1/events`", which contradicted §8.2's "attestation required per key policy". The
> implementation follows §8.2, and this is now the single statement: on `/v1/events` a key at
> `required` must present a valid assertion, a key at `preferred` may omit one, and a key at
> `off` is refused outright because an unattested writer is the one case writes cannot accept.
> Reading §7.3 literally would have made every `preferred` key — the default — unable to report
> a single impression until a Play Integrity / App Attest verifier exists, which is slice-3
> work. That is a product outage dressed as a security control: it would have blocked all
> telemetry from every correctly-configured integration while stopping no attacker who can
> simply send reads.

Reads are cacheable by audience tuple with no device identity in them, which is what makes them
effectively free at the edge. Requiring per-device attestation on reads destroys that cache to protect
content that is public by design. Writes are where poisoned data has a cost, so that is where the hard
boundary sits.

| Platform | Mechanism | Degradation |
|---|---|---|
| Android | Play Integrity standard request; server verifies via the Play Integrity API; verdict yields `packageName` + `certificateSha256Digest` | — |
| iOS / macOS | App Attest (key attestation then assertion over a server challenge) | — |
| desktop / JS / wasm | none exists | falls back to asserted identity; `required` is rejected at key creation for these platforms |

**Dev-mode is part of the model, not a workaround.** Play Integrity rejects sideloaded and debug
builds, so a `pk_test_*` key with `attestation_policy: off` is mandatory or local development stops
working. The dashboard creates one automatically alongside every `pk_live_*` key.

---

## 8. Wire API

Three Deno Edge Functions. All read with `service_role` server-side; `anon` is revoked schema-wide, so
PostgREST is not a second way in. Pattern generalized from
`mbs/reels-downloader/server-layer/supabase-backend/functions/config/index.ts`.

### 8.1 `GET /v1/configs?screen=<id>`

Resolves the key → app, verifies package/cert, applies `attestation_policy`, evaluates **audience**
server-side, returns priority-ordered matches.

```json
{ "schema_version": 1,
  "configs": [
    { "id": "…", "template": "update_available", "template_version": 1,
      "display": "dialog", "payload": { "store_url": "…", "forced": false },
      "priority": 10, "is_dismissible": true,
      "max_impressions": 1, "cooldown_hours": 24, "version": 1 } ] }
```

- `Cache-Control: public, max-age=60`, varying on the audience tuple
  (app, platform, app_version, sdk_version, screen). No device identity participates, so the response
  is shared across all devices in that tuple.
- **Fail-soft:** any internal error returns `200 {"configs": []}` with a short cache. A config surface
  must never become an error surface. The failure is reported to observability, because a fetch failure
  and an empty set are otherwise indistinguishable — the exact gap §2.1 describes.
- `403` only for identity mismatch (bad key, package, cert, or failed `required` attestation).

### 8.2 `POST /v1/events`

Batched impression / dismiss / ack / action.

```json
{ "device_id": "…",
  "events": [ { "event_id": "…", "config_id": "…", "type": "impression", "at": "…" } ] }
```

Attestation required per key policy. Rate-limited per key and per device. Returns `202` with
per-event accept/reject; a rejected event never fails the batch.

**Idempotency is per event, not per (config, device).** A client-generated `event_id` is required on
every event and deduped against `impression.seen_event_ids` (ring-buffered, last 50 per row). This
matters because the two event kinds differ: `dismiss` and `ack` are state transitions and are
naturally idempotent, but `impression` **increments a counter** — a genuine second showing must count
twice while a network retry of the first must not. Deduping on `(config_id, device_id, type)` would
have made every impression after the first invisible, silently capping `max_impressions` at 1.

### 8.3 `POST /v1/attest`

Exchanges a Play Integrity token or App Attest assertion for a short-lived (15 min) signed assertion
the client presents on writes. Verifies that the attested package and certificate match the key's
registered values — this is where attestation becomes binding rather than decorative.

---

## 9. Config types

Each is a `template` row seeded by migration. The dashboard renders a form from `payload_schema`, so
adding a type is a migration, not a dashboard release.

| `id` | Renders UI | Requires ack | Typical displays | Payload (core fields) |
|---|:-:|:-:|---|---|
| `announcement` | ✅ | | dialog, bottom_sheet, banner | title, body, image_url?, cta? |
| `information` | ✅ | | banner, inline | title, body, severity |
| `notification` | ✅ | | dialog, bottom_sheet | title, body, cta{label,action} |
| `update_available` | ✅ | | dialog, fullscreen | current_version, store_url, forced, release_notes? |
| `maintenance` | ✅ | | fullscreen, banner | title, body, window_start, window_end |
| `promo_offer` | ✅ | | bottom_sheet, fullscreen | headline, body, offer_code?, expires_at, cta |
| `rating_prompt` | ✅ | | dialog | title, body, store_url |
| `survey_nps` | ✅ | | bottom_sheet | question, scale_min, scale_max, follow_up? |
| `policy_update` | ✅ | ✅ | fullscreen, dialog | title, summary, policy_url, effective_at |
| `onboarding_tip` | ✅ | | inline, banner | title, body, anchor? |
| `paywall_upsell` | ✅ | | fullscreen, bottom_sheet | headline, benefits[], price_text, cta |
| `whats_new` | ✅ | | bottom_sheet, fullscreen | version, items[] |
| `incident_outage` | ✅ | | banner, dialog | title, body, status_url?, severity |
| `geo_notice` | ✅ | | dialog, banner | title, body, regions[] |
| `feature_flag` | ❌ | | none | key, value (bool/string/number/json) |

Two types shape the schema and must not be treated as edge cases:

- **`feature_flag` renders nothing.** `renders_ui = false`, `display = 'none'`. The model therefore
  cannot assume every config produces a surface — frequency caps and dismissal are meaningless here,
  and the dashboard must not show impression controls for it.
- **`policy_update` needs acknowledgement, not dismissal.** `requires_ack = true` ⇒ the client reports
  an `ack` event instead of a `dismiss`. A terms change a user can swipe away has not been accepted,
  so this is enforced in the database rather than left to the dashboard:

  ```sql
  alter table public.config add constraint config_ack_not_dismissible check (
    not exists (select 1 from public.template t
                where t.id = template_id and t.requires_ack)
    or is_dismissible = false
  );
  ```

  A `check` cannot subquery, so this is implemented as a `before insert or update` trigger with the
  same predicate — noted because the constraint-shaped version is the obvious first attempt and
  Postgres rejects it.

New types are added by `/idea` with Claude judgement against real app needs; the taxonomy above is the
seed set, not a closed list.

---

## 10. Where evaluation runs

| Evaluated on | Rules | Why there |
|---|---|---|
| **Server** | platform, screen, min/max app version, schedule window, template↔SDK capability, `is_enabled` | Retarget without an SDK release; the device never receives an unreleased promo; smaller payload; response stays cacheable |
| **Client** (existing `RemoteConfigEvaluator`) | impression cap, dismissed, cooldown | Device-local state; must work offline |

This split keeps both existing pieces useful. `RemoteConfigEvaluator` loses its audience filters and
keeps its frequency logic — including the fail-closed version gate, which moves server-side with the
same semantics: a config declaring a version window is **not** returned when the caller's app version
is unknown or blank, so a Play-Store update gate cannot leak onto desktop or web.

---

## 11. Dashboard

### 11.1 Stack — cloned from PayCraft

Next.js 14 (App Router) · `@supabase/ssr` · Tailwind · `lucide-react` · `recharts` ·
`@cloudflare/next-on-pages` · Playwright + Jest. Lives at `dashboard/` in this repo.

Why clone rather than choose: PayCraft's dashboard runs this exact stack in production on Cloudflare
Pages with Supabase Google auth. Picking anything else means rediscovering its auth and edge-runtime
fixes.

### 11.2 Routes

| Route | Purpose |
|---|---|
| `/auth/login` | Google sign-in button; purges stale auth artifacts first |
| `/auth/callback` | OAuth code exchange → session cookie |
| `/` | App list (cards: name, platforms, active-config count) + **New app** |
| `/apps/new` | Name, slug, platforms |
| `/apps/[id]` | Overview: active configs, recent impressions, keys summary |
| `/apps/[id]/keys` | Key list (prefix, env, platform, bundle id, cert digests, policy, revoke) + **Issue key** |
| `/apps/[id]/configs` | Config list: template, display, screens, window, enabled toggle |
| `/apps/[id]/configs/new` | Template picker → schema-driven form → targeting → schedule |
| `/apps/[id]/configs/[cid]` | Edit, enable/disable, duplicate, per-config impressions |

### 11.3 The authoring screen

The one screen that carries the product. Three stacked sections on one page, not a wizard:

1. **Type** — a card grid of templates, each with `display_name` + `description`. Selecting one
   renders the rest.
2. **Content** — form generated from `payload_schema`: string → text input, string with `maxLength`
   > 120 → textarea, boolean → switch, enum → select, `format: uri` → url input with validation,
   array → repeatable rows. A live preview panel renders the chosen `display` with the entered values,
   so the operator sees a dialog/sheet/banner, not a JSON blob.
3. **Targeting + schedule** — screens (empty = all, with an explicit "all screens" chip so empty is
   never ambiguous), platforms, app-version window, start/end, priority, impressions, cooldown,
   dismissible. `is_enabled` is a single switch at the bottom, **off by default**, labelled with what
   turning it on does.

For `feature_flag` sections 2 and 3 collapse to key/value plus targeting — no display, no preview, no
impression controls.

### 11.4 Secrets

`dashboard/cloudflare-secrets.map`, following PayCraft's explicit `WORKER_ENV_NAME = vault-alias`
format (env names differ from vault `env_var` fields, and guessing the mapping is how it breaks):

```
NEXT_PUBLIC_SUPABASE_URL      = kmp-remote-config-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY = kmp-remote-config-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY     = kmp-remote-config-supabase-service-role-key
```

`SUPABASE_SERVICE_ROLE_KEY` has **no** `NEXT_PUBLIC_` twin. It is read only in server components and
route handlers. A CI check asserts no `NEXT_PUBLIC_*` name resolves to the service-role alias — the
single highest-consequence mistake available in this codebase.

---

## 12. Deployment

**`rconfig.mobilebytesensei.com` on Cloudflare Pages**, project name `rconfig`.

```
npm run pages:build   # @cloudflare/next-on-pages
npm run pages:deploy  # wrangler pages deploy .vercel/output/static \
                      #   --project-name=rconfig --branch=release
```

`--branch` is Cloudflare's *production-branch label*, not a git ref — but it should still read
`release`, because this repo has no `main` (§D7) and a label naming a branch that does not exist is
the kind of detail that reads as a typo during an incident.

Credentials from existing vault aliases — nothing new needed: `mbs-cloudflare-account-id`,
`mbs-cloudflare-pages-api-token`.

The framework's `core/scripts/idea-site-deploy.sh` is **not** used here. It drives static
`SITE_DEPLOY.yaml` sites; a Next.js app on Pages needs the `next-on-pages` build step. PayCraft's
`infra/deploy/deploy.sh` phased pattern (build → secrets sync → deploy → verify) is the model.

Operator prerequisites to confirm before the first deploy:
- `mobilebytesensei.com` is a zone in the account behind `mbs-cloudflare-account-id`
- the Pages token carries `Pages:Edit` **and** `Zone:DNS:Edit` (the latter is what lets the deploy
  attach the custom domain rather than requiring a manual CNAME)

Edge Functions deploy via `supabase functions deploy`, which needs an account-level personal access
token. Only `framework-supabase-access-token` exists today and belongs to a different project — a
`mbs-supabase-access-token` (workspace tier; PATs are per-account) must be added to the vault before
slice 1 can ship.

---

## 13. Testing

### 13.1 RLS is the highest-risk surface

A policy bug is a cross-tenant data leak, and it will not show up in a single-user manual test.
Explicit negative tests, run in CI against a seeded database with two users and two apps:

- user A cannot `select` user B's `app`, `app_key`, `config`
- user A cannot `insert` a `config` into user B's app
- a `viewer` cannot write a `config`; an `editor` can; only an `owner` can mutate `app_member`
- **no** authenticated role can `select` or `insert` `impression`
- revoking schema usage holds: a raw PostgREST call with the anon key returns no rows from any table

### 13.2 Edge Functions

Deno tests per route with a stubbed Supabase client: key resolution, package/cert mismatch → 403,
`required` attestation missing → 403, audience filtering (platform/screen/version/schedule),
`min_sdk_version` exclusion, internal error → `200 {"configs":[]}`, event idempotency, rate-limit
rejection.

Attestation verification is tested against **recorded** Play Integrity / App Attest tokens plus a
`FakeAttestor`; no test depends on a live Google or Apple endpoint.

### 13.3 Dashboard

Playwright: sign-in redirect, create app, issue key (and that the key is shown once and listed after),
author a config from two different templates, enable it, and assert it then appears in
`GET /v1/configs` for a matching audience. Jest for the schema→form generator and the payload
validator.

### 13.4 Contract test — the payoff of one repo

A single fixture directory of `GET /v1/configs` response JSON is asserted by **both** the Edge
Function's test suite and a Kotlin `commonTest` that deserializes it into the SDK's model. One commit
that changes the wire shape without changing the model fails in CI. This is the concrete reason D4
(one repo) was chosen, and without this test that choice buys nothing.

### 13.5 Not claimed

No Roborazzi golden renders exist for the four SDK presentations, and nothing in slices 1–2 adds them.
Any "renders correctly" claim about the SDK is out of scope here and owed in slice 3.

---

## 14. Migration path for `reels-downloader`

Slice 4 work, but it constrains this schema, so it is recorded here.

`app_remote_config` rows map onto `config` as: `kind` → `template_id` (`announcement` /
`information` / `feature_flag`), `title`/`message`/`cta_label`/`cta_url` → `payload`,
`severity` → payload field, `frequency` → `max_impressions` + `cooldown_hours`, `starts_at`/`ends_at`
and `version` carry across unchanged.

Two things that must not be lost:
- reels' **web** client reads `/config` directly today. The control plane must serve a browser
  consumer, so `/v1/configs` has to be CORS-capable with an origin allowlist per app — not only a
  mobile SDK path.
- `frequency: once_per_day` is a *browser*-scoped cap keyed on a cookie, not a device id. The
  mapping is lossy and needs an explicit decision at migration time rather than a silent
  reinterpretation.

---

## 15. Open decisions

Each carries a default so none blocks implementation.

| # | Question | Default if unanswered |
|:-:|---|---|
| O1 | Locale handling — one payload per config, or per-locale variants? | One payload now; `config.locale` reserved and null. Per-locale is slice 4. |
| O2 | Rate limits | 60 req/min/key for reads, 600/min for events, 120/min per device |
| O3 | Impression retention | 90 days, then aggregate and purge per-device rows |
| O4 | Does the dashboard show a key again after creation? | Yes — it is a publishable key that ships in the client (§5.3) |
| O5 | CORS origin allowlist granularity | Per app, stored on `app`; required by §14 |

**Not a default — needs an answer before slice 5 is specced:** the proposed tier model has free users'
custom UIs automatically published as community templates while paid users choose. Those layouts carry
the author's copy and branding and sometimes customer-specific wording, so automatic publication is a
consent and licensing matter, and gating privacy behind payment invites complaints. Recommendation:
make sharing **opt-in for everyone** and make the paid tier about capacity and control — more apps,
higher quota, private template library, team seats, longer retention. Flagged, not decided.

---

## 16. Acceptance criteria for slices 1 + 2

1. A new user signs in with Google at `rconfig.mobilebytesensei.com` and lands on an empty app list.
2. They create two apps; each shows only its own configs and keys.
3. A second user signs in and sees neither — proven by the §13.1 negative tests, not by inspection.
4. Issuing a key produces an `rck_live_*` **and** an `rck_test_*` with `attestation_policy: off`.
   *(Amended 2026-10-05, review finding M1: the prefix shipped as `rck_`, not `pk_`. `pk_live_`
   is byte-identical to Stripe's publishable-key format, and the framework's secret-output
   guard flags it as one — it fired on a generated key mid-review. Every e2e run, seed read
   and dashboard key listing would have raised a false secrets alert, and a guard that cries
   wolf gets ignored.)*
5. Authoring an `update_available` config renders a form from its schema, previews the dialog, and
   saves disabled by default.
6. Enabling it makes it appear in `GET /v1/configs` for a matching audience tuple, and absent for a
   non-matching platform, screen, or app-version window.
7. A config whose template declares a `min_sdk_version` above the caller's `X-RC-SDK-Version` is
   **not** returned.
8. A wrong `X-RC-Package` returns `403`; an internal fault returns `200 {"configs": []}`.
9. `POST /v1/events` rejects a missing attestation when the key requires it, and is idempotent on
   repeated impressions.
10. The contract fixture (§13.4) passes in both the Deno and Kotlin suites.
11. No `NEXT_PUBLIC_*` env name resolves to the service-role alias (CI-asserted).
12. `feature_flag` authoring shows no display, preview, or impression controls.

---

## 17. References

- `cmp-remote-config/src/commonMain/kotlin/com/mobilebytelabs/remoteconfig/network/RemoteConfigService.kt` — current anon-key read path
- `cmp-remote-config/src/commonMain/kotlin/com/mobilebytelabs/remoteconfig/RemoteConfigEvaluator.kt` — the frequency logic this keeps
- `mbs/reels-downloader/server-layer/supabase-backend/migrations/013_rls_hardening.sql` — the anon-lockdown posture adopted here
- `mbs/reels-downloader/server-layer/supabase-backend/functions/config/index.ts` — the Edge Function pattern generalized
- `mbs/PayCraft/source/PayCraft/dashboard/` — the dashboard stack, auth flow, and secrets map cloned
- `workspaces/mbs/kmp-remote-config/idea-layer/` — IDEA, REQUIREMENTS (CR/AR), MODULES, ROADMAP
