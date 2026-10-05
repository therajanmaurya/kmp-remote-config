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
