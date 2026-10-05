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
         004_template 005_config 006_impression; do
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
```

Then smoke-test identity, which must be LOUD:

```bash
BASE="https://<ref>.supabase.co/functions/v1"
curl -s -o /dev/null -w "bogus key → %{http_code}\n" "$BASE/v1-configs" -H "X-RC-Key: pk_live_bogus"
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
deno test --allow-env --allow-read supabase/functions/   # all 4 Deno suites
bash supabase/tests/seed_local.sh                        # one app + key + 3 configs
```

Ports are offset to 56xxx because 54xxx and 55xxx are taken by other projects' local stacks
(the +1000-per-project convention in `docs/guides/server/LOCAL_SUPABASE_GUIDE.md`).
`supabase/tests/psql.sh` resolves the connection from `supabase status`, so nothing here
hardcodes a DSN.
