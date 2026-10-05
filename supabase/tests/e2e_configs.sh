#!/usr/bin/env bash
# End-to-end assertions against a RUNNING local function server. Opt-in, not part of
# run.sh, because it needs `supabase functions serve v1-configs` up.
#
#   supabase functions serve v1-configs --no-verify-jwt &
#   bash supabase/tests/seed_local.sh
#   bash supabase/tests/e2e_configs.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

API=$(supabase status -o env 2>/dev/null | grep -E '^API_URL=' | cut -d= -f2- | tr -d '"')
[ -n "$API" ] || { echo "e2e: local stack not running" >&2; exit 3; }
B="$API/functions/v1/v1-configs"
K="rck_live_LOCALTESTKEY0000000000000000000"
H=(-H "X-RC-Key: $K" -H "X-RC-Package: com.example.app" -H "X-RC-Platform: android"
   -H "X-RC-App-Version: 4.2.0" -H "X-RC-SDK-Version: 4.0.0")
fail=0

check() { # name expected actual
  printf '  %-56s ' "$1"
  if [ "$2" = "$3" ]; then echo "PASS"; else echo "FAIL (expected $2, got $3)"; fail=1; fi
}

n_home=$(curl -s "$B?screen=home" "${H[@]}" | jq '.configs|length')
# 5 configs are enabled; a future starts_at and a past ends_at must both be filtered out,
# and the settings-targeted one must not match screen=home.
check "screen=home returns only in-window, untargeted configs" 2 "$n_home"

titles=$(curl -s "$B?screen=home" "${H[@]}" | jq -c '[.configs[].payload.title]')
check "expired + future configs are absent" '["Hello",null]' "$titles"

n_none=$(curl -s "$B" "${H[@]}" | jq '.configs|length')
check "omitted screen returns only untargeted configs" 2 "$n_none"

n_settings=$(curl -s "$B?screen=settings" "${H[@]}" | jq '.configs|length')
check "screen=settings adds the targeted config" 3 "$n_settings"

code=$(curl -s -o /dev/null -w '%{http_code}' "$B" -H "X-RC-Key: rck_live_bogus")
check "unknown key is a loud 403, not an empty list" 403 "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' "$B" -H "X-RC-Key: $K" -H "X-RC-Package: com.evil.app")
check "package mismatch is 403" 403 "$code"

cc=$(curl -s -D- -o /dev/null "$B?screen=home" "${H[@]}" | grep -i '^cache-control' | tr -d '\r' | cut -d' ' -f2-)
check "happy path is edge-cacheable" "public, max-age=60" "$cc"

vary=$(curl -s -D- -o /dev/null "$B?screen=home" "${H[@]}" | grep -i '^vary' | tr -d '\r')
case "$vary" in *X-RC-Key*) v=yes ;; *) v=no ;; esac
check "Vary includes X-RC-Key (shared-cache tenant leak)" yes "$v"

# M3 — the unit stub ignores .eq()/.is() arguments, so deleting the revoked_at filter from
# identity.ts still passes every Deno test. Only an end-to-end call with a genuinely
# revoked row can pin it.
bash supabase/tests/psql.sh -c "INSERT INTO public.app_key (app_id, key, environment, platform, bundle_id, revoked_at) VALUES ('d0000000-0000-0000-0000-0000000000aa','rck_live_REVOKEDKEY00000000000000000','live','android','com.example.app', now()) ON CONFLICT (key) DO UPDATE SET revoked_at = now();" >/dev/null 2>&1
code=$(curl -s -o /dev/null -w '%{http_code}' "$B" -H "X-RC-Key: rck_live_REVOKEDKEY00000000000000000" \
  -H "X-RC-Package: com.example.app" -H "X-RC-Platform: android" -H "X-RC-SDK-Version: 4.0.0")
check "a REVOKED key is 403, not an empty list" 403 "$code"

# M7 — a key pinned to android must refuse a web-asserted platform
code=$(curl -s -o /dev/null -w '%{http_code}' "$B" -H "X-RC-Key: $K" -H "X-RC-Package: com.example.app" \
  -H "X-RC-Platform: web" -H "X-RC-SDK-Version: 4.0.0")
check "platform mismatch against a pinned key is 403" 403 "$code"

[ "$fail" -eq 0 ] && echo "✓ e2e configs: all checks passed" || echo "✗ e2e configs FAILED" >&2
exit "$fail"
