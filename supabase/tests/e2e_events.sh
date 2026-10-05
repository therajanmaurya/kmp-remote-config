#!/usr/bin/env bash
# End-to-end assertions for /v1/events against a RUNNING local function server.
#
#   supabase functions serve v1-events --no-verify-jwt &
#   bash supabase/tests/seed_local.sh
#   bash supabase/tests/e2e_events.sh
#
# This route carried C2 (cross-tenant write) and had no e2e coverage at all, which is how a
# missing tenant scope survived a unit suite that was otherwise thorough.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

API=$(supabase status -o env 2>/dev/null | grep -E '^API_URL=' | cut -d= -f2- | tr -d '"')
[ -n "$API" ] || { echo "e2e: local stack not running" >&2; exit 3; }
B="$API/functions/v1/v1-events"
K="rck_live_LOCALTESTKEY0000000000000000000"
fail=0
check() { printf '  %-58s ' "$1"; if [ "$2" = "$3" ]; then echo PASS; else echo "FAIL (want $2, got $3)"; fail=1; fi }

post() { # body -> http code
  curl -s -o /tmp/rc-ev-out -w '%{http_code}' -X POST "$B" \
    -H "X-RC-Key: $K" -H "X-RC-Package: com.example.app" -H "X-RC-Platform: android" \
    -H "X-RC-SDK-Version: 4.0.0" -H "content-type: application/json" --data "$1"
}

OWN="cccccccc-0000-0000-0000-00000000000a"

# Idempotent by construction: the script reuses fixed event ids, and dedupe would
# (correctly) refuse them on a second run, so clear this script's own rows first. Scoped to
# its e2e-* device ids — it must never touch another fixture's data.
bash supabase/tests/psql.sh -c "DELETE FROM public.impression WHERE device_id LIKE 'e2e-%';" >/dev/null 2>&1

code=$(post "{\"device_id\":\"e2e-dev\",\"events\":[{\"event_id\":\"e2e-1\",\"config_id\":\"$OWN\",\"type\":\"impression\"}]}")
check "a well-formed batch is accepted" 202 "$code"
check "…and the event applied" 1 "$(jq '.accepted' /tmp/rc-ev-out)"

# Retry of the SAME event_id must not inflate the count.
post "{\"device_id\":\"e2e-dev\",\"events\":[{\"event_id\":\"e2e-1\",\"config_id\":\"$OWN\",\"type\":\"impression\"}]}" >/dev/null
check "a retried event_id is not applied twice" 0 "$(jq '.accepted' /tmp/rc-ev-out)"
n=$(bash supabase/tests/psql.sh -t "SELECT count FROM public.impression WHERE config_id='$OWN' AND device_id='e2e-dev';" 2>/dev/null | tr -d ' \n')
check "count stayed at 1 after the retry" 1 "$n"

# C2 regression guard: a config belonging to ANOTHER app must be refused, and must not
# create a row. Uses a uuid that does not belong to this key's app.
FOREIGN="cccccccc-0000-0000-0000-0000000000ff"
bash supabase/tests/psql.sh -c "INSERT INTO auth.users (id,email) VALUES ('e0000000-0000-0000-0000-00000000e001','other@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.app (id,owner_id,slug,display_name) VALUES ('e0000000-0000-0000-0000-0000000000bb','e0000000-0000-0000-0000-00000000e001','other-app','Other') ON CONFLICT DO NOTHING;
INSERT INTO public.config (id,app_id,template_id,payload,display,is_enabled) VALUES ('$FOREIGN','e0000000-0000-0000-0000-0000000000bb','announcement','{\"title\":\"victim\",\"body\":\"x\"}','dialog',true) ON CONFLICT DO NOTHING;" >/dev/null 2>&1
post "{\"device_id\":\"e2e-attacker\",\"events\":[{\"event_id\":\"e2e-x\",\"config_id\":\"$FOREIGN\",\"type\":\"impression\"}]}" >/dev/null
check "a foreign tenant's config is NOT applied" 0 "$(jq '.accepted' /tmp/rc-ev-out)"
n=$(bash supabase/tests/psql.sh -t "SELECT count(*) FROM public.impression WHERE config_id='$FOREIGN';" 2>/dev/null | tr -d ' \n')
check "…and no impression row was created under them" 0 "$n"

code=$(post '{"events":[]}')
check "a batch with no device_id is 403" 403 "$code"
code=$(post "{\"device_id\":\"d\",\"events\":[{\"config_id\":\"$OWN\",\"type\":\"impression\"}]}")
check "an event with no event_id is 403" 403 "$code"

# I7 regression guard: the 202 must carry CORS, or a browser passes preflight then blocks.
post "{\"device_id\":\"e2e-cors\",\"events\":[{\"event_id\":\"e2e-c\",\"config_id\":\"$OWN\",\"type\":\"impression\"}]}" >/dev/null
acao=$(curl -s -D- -o /dev/null -X POST "$B" -H "X-RC-Key: $K" -H "X-RC-Package: com.example.app" \
  -H "X-RC-Platform: android" -H "X-RC-SDK-Version: 4.0.0" -H "content-type: application/json" \
  --data "{\"device_id\":\"e2e-cors2\",\"events\":[]}" | grep -ic 'access-control-allow-origin')
check "the response carries CORS headers" 1 "$acao"

rm -f /tmp/rc-ev-out
[ "$fail" -eq 0 ] && echo "✓ e2e events: all checks passed" || echo "✗ e2e events FAILED" >&2
exit "$fail"
