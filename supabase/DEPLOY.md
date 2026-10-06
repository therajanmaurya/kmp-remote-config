# Deploying the control plane

> **Status: not yet deployed.** Tasks 1–12 of the control-plane plan are green against the
> LOCAL stack. Deployment is blocked on two human-supplied preconditions (below).

## Blocked on

| # | Precondition | How to satisfy |
|:-:|---|---|
| P2 | `project_ref` is `null` | Put the `<ref>` from `https://<ref>.supabase.co` into `workspaces/mbs/kmp-remote-config/secrets-manifest.yaml#supabase.project_ref` **and** `core/registries/SUPABASE_ACCOUNTS_REGISTRY.yaml` (account `mobilebytesensei-remote-config`, project `rconfig`). Not a secret — it ships in every client bundle |
| P3 | account PAT not vaulted | `bash core/scripts/secrets-handoff.sh paste --id kmp-remote-config-supabase-access-token --alias kmp-remote-config-supabase-access-token --kind env_var --deploy-to secrets/live/_env/SUPABASE_ACCESS_TOKEN` — token from https://supabase.com/dashboard/account/tokens signed in as `mobilebytesensei+remote-config@gmail.com`. The alias row is already registered |

Already satisfied: the four `kmp-remote-config-supabase-{url,anon-key,service-role-key,db-password}`
aliases are vaulted and materialize to `secrets/live/_env/` at 0600.

## The sanctioned path

Migrations and functions go through `core/scripts/supabase-connect.sh`
(RULE-SUPABASE-ACCESS-001). Never hand-build a connection string or pass a token inline —
`supabase-connect-guard.sh` blocks it.

```bash
bash core/scripts/supabase-connect.sh db-push <file.sql>      --target mbs/kmp-remote-config
bash core/scripts/supabase-connect.sh psql    -- "<sql>"      --target mbs/kmp-remote-config
bash core/scripts/supabase-connect.sh functions deploy <name> --target mbs/kmp-remote-config
```

### Order

```bash
for m in 001_schema_hardening 002_app_and_members 003_app_key \
         004_template 005_config 006_impression 007_routine_grant_sweep; do
  bash core/scripts/supabase-connect.sh db-push "supabase/migrations/${m}.sql" \
    --target mbs/kmp-remote-config
done

bash core/scripts/supabase-connect.sh functions deploy v1-configs --target mbs/kmp-remote-config
bash core/scripts/supabase-connect.sh functions deploy v1-events  --target mbs/kmp-remote-config
bash core/scripts/supabase-connect.sh functions deploy v1-attest  --target mbs/kmp-remote-config
```

### Verify after pushing — these three, not just "it ran"

```bash
# every table present
bash core/scripts/supabase-connect.sh psql --target mbs/kmp-remote-config -- \
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1;"
#   expect: app, app_key, app_member, config, impression, template

# the seed landed
bash core/scripts/supabase-connect.sh psql --target mbs/kmp-remote-config -- \
  "SELECT count(*) FROM public.template WHERE is_builtin;"
#   expect: 15

# the hardening actually took effect — this is the one that matters
bash core/scripts/supabase-connect.sh psql --target mbs/kmp-remote-config -- \
  "SELECT has_schema_privilege('anon','public','USAGE') AS anon_usage,
          nspacl FROM pg_namespace WHERE nspname='public';"
#   expect: anon_usage = f, and NO bare '=U/' entry in nspacl (an empty grantee is PUBLIC,
#   and PUBLIC holding USAGE is what made the first local attempt a no-op)

# routine grants — 007's sweep must have held
bash core/scripts/supabase-connect.sh psql --target mbs/kmp-remote-config -- \
  "SELECT count(*) AS anon_callable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE');"
#   expect: 0
```

### Why 007 exists, and the trap it guards

`ALTER DEFAULT PRIVILEGES` in 001 is **not sufficient** for routines. Default privileges are
stored per grantor, and only the grantor can revoke its own. A fresh Supabase database holds
two rows for `(public, function)`:

| grantor | default ACL |
|---|---|
| `postgres` | `{postgres=X, service_role=X}` — 001's revoke lands here |
| `supabase_admin` | `{postgres=X, anon=X, authenticated=X, service_role=X}` |

`postgres` is not a member of `supabase_admin`, so it cannot touch the second row. The
observable effect is that a brand-new function in `public` lands with `=X/postgres` in its
ACL — an **empty grantee, which is the PUBLIC pseudo-role** — and `anon` then has EXECUTE by
inheritance with no grant naming it. Same class as the hole that made 001's first draft a
no-op.

So 007 sweeps the END STATE: revoke from everything, re-grant the allowlist. **A routine
added in a later migration is not covered** — it must carry its own REVOKE/GRANT pair, and
`harness_test.sql` asserts the end state so an unguarded addition fails the suite.

### anon retains USAGE on other schemas

Measured on a fresh stack: `graphql_public`, `storage`, `auth`, `extensions` and `realtime`
all grant `anon` USAGE; only `public` and `vault` do not. This product is safe because every
path lands in `public`, where `anon` holds nothing — but **enabling the Data API, GraphQL, or
Storage would open a surface the §5 posture does not cover.** Harden the specific schema
before turning any of those on.

Then smoke-test identity, which must be LOUD:

```bash
BASE="https://<ref>.supabase.co/functions/v1"
curl -s -o /dev/null -w "bogus key → %{http_code}\n" "$BASE/v1-configs" -H "X-RC-Key: rck_live_bogus"
curl -s -o /dev/null -w "no key    → %{http_code}\n" "$BASE/v1-configs"
```

Both must be **403**. A `200` with an empty list here means the identity checks are not
wired, and it is indistinguishable from "no configs" to an integrator — stop and fix.

## Function environment

Set in the Supabase dashboard; values come from the vault and are never echoed.

| Name | Vault alias | Notes |
|---|---|---|
| `SUPABASE_URL` | `kmp-remote-config-supabase-url` | |
| `SUPABASE_SERVICE_ROLE_KEY` | `kmp-remote-config-supabase-service-role-key` | server-only; never a `NEXT_PUBLIC_*` name |
| `RC_ASSERTION_SECRET` | `kmp-remote-config-assertion-secret` | generate with `source: generate:openssl-rand-32`; alias registered, value not yet pushed |
| `ATTEST_VERIFY_ENDPOINT` | — | **not provisioned.** While unset, `/v1/attest` REFUSES rather than passing: an unverifiable attestation that succeeded would hand assertions to anyone while looking secure |

## Migrations and rollbacks

Forward-only, numbered `NNN_name.sql`. Rollbacks live in **`supabase/rollbacks/`**, not
`supabase/migrations/` — the CLI treats the migrations directory as the migration set, and
it ignores `rollback_*` today only because the filename lacks a leading numeric version.

⚠ A rollback is for LOCAL experimentation. Running `rollback_001` against the deployed
project re-opens every table in `public` to the anon key, which is the exact posture this
control plane exists to prevent. If the hardening needs changing, write a forward migration.

## Local development

```bash
supabase start                  # ports are the 56xxx block, see supabase/config.toml
bash supabase/tests/run.sh      # all 7 SQL assertions
deno test --allow-env --allow-read supabase/functions/   # all Deno suites

# End-to-end (needs the function server up and the seed applied):
supabase functions serve --no-verify-jwt &
bash supabase/tests/seed_local.sh
bash supabase/tests/e2e_configs.sh    # 9 checks incl. revoked key, Vary, schedule window
bash supabase/tests/e2e_events.sh     # 9 checks incl. the C2 cross-tenant regression guard
```

Keys are prefixed `rck_live_` / `rck_test_`, **not** `pk_*`: `pk_live_` is byte-identical to
Stripe's publishable-key format and the framework's secret-output guard flags it as one, so
every e2e run and key listing would raise a false secrets alert.

Ports are offset to 56xxx because 54xxx and 55xxx are taken by other projects' local stacks
(the +1000-per-project convention in `docs/guides/server/LOCAL_SUPABASE_GUIDE.md`).
`supabase/tests/psql.sh` resolves the connection from `supabase status`, so nothing here
hardcodes a DSN.


---

## Deployed to `gohifhjcvsawcdhcpbkw` — 2026-10-05

All 7 migrations applied; 3 functions live. Verified against the live project, not inferred:

| Check | Result |
|---|---|
| Tables | `app, app_key, app_member, config, impression, template` |
| Seeded templates | `builtins = 15`, `flag_renders_nothing = t`, `policy_needs_ack = t` |
| Schema hardening | `anon_usage = f`, `public_has_usage = f` |
| Routine sweep (007) | `anon_callable = 0`, `authenticated_callable = 3` (the allowlist) |
| Extensions | `pg_jsonschema 0.3.3`, `pgcrypto 1.3` |
| Live e2e | `200` with the contract shape; `403 package_mismatch`, `403 platform_mismatch`, `403 key_invalid`, `403 key_missing` |
| Caching | `cache-control: public, max-age=60` + the full `Vary` tuple |

### `verify_jwt = false` is deliberate

The three routes landed with `verify_jwt: true` on first deploy and returned
`401 UNAUTHORIZED_NO_AUTH_HEADER` — the platform rejected every request before any of this
repo's identity code ran. These routes authenticate by **publishable key** (`X-RC-Key`) plus
package/cert/platform binding, not by a Supabase user JWT; a JWT gate in front of them is the
wrong boundary and simply makes the product unreachable. The setting is committed in
`supabase/config.toml` so a redeploy cannot silently restore it.

### `RC_ASSERTION_SECRET`

Set as a function secret via `core/scripts/secrets-sync-to-supabase.sh --apply` (the sanctioned
path — `supabase-connect-guard.sh` refuses a hand-rolled `secrets set`). Confirmed present on
the project by name through the Management API.

### Standing caveat: `/v1/attest` has nothing behind it

`ATTEST_VERIFY_ENDPOINT` is unset and no Play Integrity / App Attest verifier exists in this
repo yet, so **`/v1/attest` refuses every request by design** — an attestation that "succeeded"
without verification would hand out assertions to anyone while looking secure. Consequence: a
key set to `attestation_policy: required` rejects all traffic until that verifier ships
(slice 3). Keys left at the `preferred` default are unaffected. See spec §7.3 as amended.


## Rate limiting (migration 008) — deployed 2026-10-05

O2's numbers, enforced in Postgres rather than in the Deno isolate. An in-isolate counter
divides the real limit by however many isolates are warm, so a "60/min" rule would admit
60 × N; the only state every isolate shares on this request's path is the database.

| Subject | Limit | Source |
|---|---|---|
| `key:<id>:read` | `app_key.rate_limit_per_min` (default 60) | per-key column, operator-tunable |
| `key:<id>:events` | 600/min | constant |
| `device:<app>:<device>` | 120/min | constant |

- **Fails open.** An unreachable limiter admits the request: it is cost control, not the
  authorization boundary (that is the key binding plus the attestation gate, untouched by
  this path). Failing closed would trade a bounded cost problem for an unbounded
  availability one.
- **429, not an empty list.** A limited caller is correctly configured and merely too
  fast, so `{"error":"rate_limited","retry_after":N}` with `Retry-After` and
  `X-RateLimit-*` is actionable. `no-store`, so a cached 429 cannot pin a tenant past
  their own reset.
- **Quota headers are omitted from the cacheable 200.** `/v1/configs` is
  `public, max-age=60`, so a shared cache would replay one device's remaining count to
  every other device in the audience tuple. A confidently wrong header is worse than an
  absent one.
- **`purge_rate_buckets()` needs scheduling.** Device subjects are unbounded in
  cardinality. It is not called from the hot path (that would add a DELETE scan to every
  request to save a nightly job). Until scheduled, growth is one row per distinct device
  per app — bounded by the install base. Same scheduler O3's 90-day impression retention
  will need.
- **Not covered:** a caller hammering with an *invalid* key is not rate-limited, because
  the subject is the resolved key id and an invalid key 403s before the limiter. That
  needs an IP-keyed limit, which O2 does not specify.

Verified live on `gohifhjcvsawcdhcpbkw`: a key at 3/min returned `200 200 200 429 429`,
with `retry-after: 52`, `cache-control: no-store`, `x-ratelimit-limit: 3`.

Migration 008 carries its own `REVOKE`/`GRANT` pair, as 007's sweep warns a later
migration must. Without it, both new functions landed with `=X/postgres` in `proacl` — an
empty grantee, i.e. the PUBLIC pseudo-role — so `anon` and `authenticated` held EXECUTE by
inheritance with no grant naming either, and `harness_test.sql` failed with
"anon can EXECUTE 2 routine(s) in public". The sweep's warning is load-bearing, not
decorative.


## Custom templates and community sharing (migration 009) — deployed 2026-10-05

Per-app custom templates (`is_builtin = false`, `app_id` set, id prefixed `c_`) plus an
opt-in community catalog. Spec §15 has the decision and what remains open.

| Guarantee | How it is enforced |
|---|---|
| A template is born private | INSERT policy permits only `visibility = 'private'`; `template_guard` refuses otherwise |
| Consent cannot be forged | `shared_at` / `shared_by` stamped by the trigger from `now()` / `auth.uid()`, never from the client |
| Withdrawal is real | `community → private` clears the consent record; already-forked copies keep working |
| A builtin cannot be "shared" | `template_builtin_not_shareable` — it is already global, and 'community' would credit a user for our seed data |
| A custom id cannot pass for ours | `template_custom_id_shape` requires `c_…`, so provenance is legible in `config.template_id` and in SDK logs |
| Identity is immutable | `template_guard` refuses changes to `id`, `is_builtin`, `app_id` |
| One tenant cannot reach another's | `template_select` exposes builtins, own-app rows, and `community` only; a private row of another app is invisible, and a refused fork says "unknown template" rather than confirming it exists |
| Adoption copies | `fork_template` writes a private copy with `forked_from`; it is SECURITY DEFINER and checks `has_app_role` on the **destination**, so it cannot be used to plant templates in someone else's app |
| Deletion is owner-only | an editor may create and share; deleting a template others forked from is not recoverable |

**Pre-existing hole closed here:** `config_template_coherence` resolved the template by id
with no tenancy check. Harmless while every template was global; with per-app templates a
config could reference another tenant's private row, coupling the two apps (A's delete
breaks B's live configs) and leaking A's schema through validation errors. The trigger now
rejects it with "belongs to another app; fork it into this app first".

Verified live on `gohifhjcvsawcdhcpbkw`: 5 sharing columns, 4 policies, all 15 builtins
still `private`, `anon` callable routines = 0, `authenticated` callable exactly
`fork_template, generate_publishable_key, has_app_role, is_app_member`.

`harness_test.sql`'s allowlist gained `fork_template` deliberately — and it failed by name
first, which is how the end-state assertion is supposed to behave.

**Not yet built:** the dashboard UI for authoring a custom template and browsing the
catalog. That is Task 11 of `rconfig-dashboard/PLAN.md`; the server half above is complete
and tested without it.


## Dashboard — deployed 2026-10-06

**https://rconfig.mobilebytesensei.com** · Cloudflare Pages project `rconfig`
(`rconfig-8nq.pages.dev`), production branch `release`.

Verified live: `/api/health` → `{"ok":true,"missing_count":0}`; `/` → 307 → `/auth/login`
with the Google button rendered; no shipped JS chunk contains `"role":"service_role"` or a
service-role JWT.

### What the deploy needed that the spec did not say

- **Every dynamic route must `export const runtime = "edge"`.** `next-on-pages` refuses the
  build and lists each offending route. Ten routes needed it.
- **`.npmrc` with `legacy-peer-deps=true`.** The spec's "known-good" trio
  (next@14.2.35 + next-on-pages@1.13.16 + modern wrangler) is no longer installable under
  strict peer resolution: next-on-pages now wants `next >=14.3.0` and
  `@cloudflare/workers-types@^4`, while current wrangler wants `^5`. PayCraft's tree
  predates both tightenings. It must live in `.npmrc`, not a flag, because next-on-pages
  shells out to `vercel build` which runs its OWN `npm install`.
- **wrangler pinned to 4.125.0.** 4.147 delegates `pages` commands to the Workers-based
  successor and the delegation fails here; its own error says to pass `--force` to target
  classic Pages. Pinning is cleaner than forcing on every call.
- **The custom domain is API-only.** wrangler 4.125 has no `pages domain` command. The
  domain was attached via `POST /accounts/{id}/pages/projects/rconfig/domains`, and the
  CNAME (`rconfig` → `rconfig-8nq.pages.dev`, proxied) had to be created explicitly — it
  was NOT auto-created even though the zone is on the same account.
- **All three variables are set as Pages secrets, not just the service-role key.**
  `NEXT_PUBLIC_*` are inlined into the client bundle at build time, but server-side reads
  in the edge runtime need them present at runtime too.

### A health-check bug this surfaced

The first deploy reported `{"ok":false,"missing_count":3}` on a correctly-configured
project. The route read `process.env[name]` from a list — a COMPUTED key, which Next's
build-time substitution cannot see. Only literal `process.env.FOO` is replaced. Fixed to
literal reads inside the handler.

### Not verified in production

Signed-in flows. The dashboard authenticates only through Google, and a scripted OAuth
round trip is not available here — the signed-in walkthroughs (app creation, key issuance,
authoring, template sharing, cross-tenant isolation) are covered by the 15 Playwright tests
against a local stack with real RLS. Production coverage is health + the anonymous redirect
+ the bundle scan.


## Display-token closure (migration 010) — deployed 2026-10-06

The SDK's `DisplayType` knows `dialog`, `fullscreen`, `banner`, `bottom_sheet` and
**falls back to DIALOG for anything else**. Two seeded builtins declared `inline`
(`information`, `onboarding_tip`), so an `inline` config would have rendered as a full
modal dialog on device with nothing reporting the mismatch.

Both rows now offer `banner` only, and two CHECK constraints make the class unreachable:
`template_displays_renderable` and `config_display_renderable` restrict values to the four
SDK presentations plus `none` (how a value-only template says it draws nothing). The
constraint lives in the database rather than the dashboard because a template created
through the API would otherwise bypass the dashboard's own refusal.

Verified on prod: 0 templates declare `inline`, both constraints present, 15 builtins
intact, and an `UPDATE … allowed_displays = {inline}` is refused by check violation.

When the SDK grows an INLINE presentation, this constraint is the single place to change.

### Client half closed — 2026-10-07 (Phase 01 / T3)

The constraint above made an unrenderable display unreachable from the SERVER. The client
half is now shut too: `DisplayType.from()` returns **null** for any value it does not
recognize instead of falling back to `DIALOG`, and `RemoteConfigHost` renders nothing when
it does. Two cases this closes that the constraint alone cannot:

- `display: "none"` is permitted by the constraint (it is how a value-only template says it
  draws nothing). Under the old fallback it mapped to `DIALOG`, so a feature flag could have
  put a modal on screen.
- A presentation added to the control plane LATER reaches an older SDK as an unknown string.
  The database constraint cannot help there — the row is valid, the client is just old. An
  old client now renders nothing rather than drawing a template in a shape it was never
  designed for.

So the two halves cover different failure modes and both are needed: the constraint stops
bad rows being written, the client stops good-but-newer rows being mis-drawn.

## Live checks

| Script | Asserts | Needs |
|---|---|---|
| `supabase/tests/e2e_sdk_contract.sh` | the DEPLOYED `/v1-configs` still speaks the shipped SDK wire model | service_role (vault, or `RC_SERVICE_ROLE_KEY` in CI) |

`e2e_sdk_contract.sh` (Phase 01 / T5) seeds a sentinel app + test key + config on the deployed
project, fetches through the real edge function exactly as `RemoteConfigService` does, parses the
captured body with the production `RemoteConfigEnvelope` under a **strict** reader
(`ignoreUnknownKeys = false`), then deletes the sentinel app — `app_key` and `config` both
cascade from it, so one DELETE cannot leave a half-removed sentinel behind. Idempotent: the app
upserts on `(owner_id, slug)` and re-running leaves zero residue.

It catches what the committed contract test structurally cannot. `ContractFixtureTest` proves the
SDK model agrees with a fixture a human wrote; a local stack is BUILT from the same committed
migrations, so neither can notice a migration applied to prod and never reflected in the
contract. Only a call to the live plane can.

The strict reader is deliberate and is the opposite of the SDK's own lenient one. The SDK must
tolerate an unknown field so an old client survives a new server; this check exists to *notice*
that, loudly, the moment the deployed function grows a field the committed model has never seen.

**It needs an auth user to own the sentinel app** (`app.owner_id` is `NOT NULL REFERENCES
auth.users`). It resolves one from the project and never creates one. On a project with no users
it exits 4 and asserts nothing.

### State of the deployed plane — 2026-10-07

| Table | Rows |
|---|---|
| `template` | 15 (the builtins) |
| `app` | 0 |
| `app_key` | 0 |
| `config` | 0 |
| `auth.users` | 1 (google) |

One operator has signed in; **no app, key or config has ever been created through the dashboard.**
The 15 builtin templates are seed data from migration 004, not operator output. So the dashboard
being deployed and reachable is not evidence that an operator can drive it end to end — that is
still unproven, and is what the epic's G-11 walkthrough exists to establish.
