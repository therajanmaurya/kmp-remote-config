#!/usr/bin/env bash
# End-to-end rate limiting (migration 008 + _shared/rate-limit.ts, spec §8.2 / O2).
#
#   supabase functions serve --no-verify-jwt &
#   bash supabase/tests/seed_local.sh
#   bash supabase/tests/e2e_rate_limit.sh
#
# The unit tests prove the SQL arithmetic and the Deno fail-open behaviour separately.
# What only an end-to-end run can prove is that the two halves are actually CONNECTED —
# that a real HTTP request consumes a real bucket and gets a real 429. A limiter wired to
# the wrong subject, or whose verdict is computed and then ignored, passes every unit test
# in this repo.
#
# Idempotent: clears its own buckets first and restores the key's limit on exit, so a
# second run behaves identically to the first.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

API=$(supabase status -o env 2>/dev/null | grep -E '^API_URL=' | cut -d= -f2- | tr -d '"')
[ -n "$API" ] || { echo "e2e: local stack not running" >&2; exit 3; }

CFG="$API/functions/v1/v1-configs"
EVT="$API/functions/v1/v1-events"
K="rck_live_LOCALTESTKEY0000000000000000000"
H=(-H "X-RC-Key: $K" -H "X-RC-Package: com.example.app" -H "X-RC-Platform: android"
   -H "X-RC-App-Version: 4.2.0" -H "X-RC-SDK-Version: 4.0.0")
fail=0

check() { printf '  %-62s ' "$1"; if [ "$2" = "$3" ]; then echo "PASS"; else echo "FAIL (expected $2, got $3)"; fail=1; fi; }
sql()   { bash supabase/tests/psql.sh -t "$1" 2>/dev/null | tr -d ' \r'; }

# Restore the key's real limit no matter how this exits — leaving it at 3 would make every
# later e2e run mysteriously 429.
restore() { bash supabase/tests/psql.sh -c "UPDATE public.app_key SET rate_limit_per_min = 60 WHERE key = '$K';" >/dev/null 2>&1; }
trap restore EXIT

# ---- arrange: a 3/min read quota, empty buckets ----------------------------
bash supabase/tests/psql.sh -c "
  UPDATE public.app_key SET rate_limit_per_min = 3 WHERE key = '$K';
  DELETE FROM public.rate_bucket;" >/dev/null 2>&1

echo "── reads: the key's own rate_limit_per_min ──"

codes=""
for _ in 1 2 3 4 5; do
  codes="$codes$(curl -s -o /dev/null -w '%{http_code} ' "$CFG?screen=home" "${H[@]}")"
done
# 3 allowed (the limit is inclusive), then denied.
check "3 of 3 pass, then 429" "200 200 200 429 429 " "$codes"

# ---- the 429 must be actionable, and must not be cached --------------------
hdrs=$(curl -s -D- -o /dev/null "$CFG?screen=home" "${H[@]}")
retry=$(printf '%s' "$hdrs" | grep -i '^retry-after:' | tr -d '\r' | awk '{print $2}')
check "429 carries a positive Retry-After" "yes" "$([ -n "$retry" ] && [ "$retry" -gt 0 ] 2>/dev/null && echo yes || echo "no(${retry:-absent})")"

cc=$(printf '%s' "$hdrs" | grep -i '^cache-control:' | tr -d '\r' | cut -d' ' -f2-)
# A cached 429 would pin the tenant at the edge past their own quota reset.
check "429 is no-store" "no-store" "$cc"

lim=$(printf '%s' "$hdrs" | grep -i '^x-ratelimit-limit:' | tr -d '\r' | awk '{print $2}')
check "429 reports the limit that was applied" "3" "$lim"

body_err=$(curl -s "$CFG?screen=home" "${H[@]}" | jq -r '.error')
check "429 body names the condition" "rate_limited" "$body_err"

# ---- a limited READ must not block EVENTS ---------------------------------
# Separate subjects: at 600/min a normal client would otherwise burn a 60/min read quota
# ten times over and black out its own config fetches.
echo "── events have their own bucket ──"
cid=$(sql "SELECT id::text FROM public.config WHERE app_id = (SELECT app_id FROM public.app_key WHERE key='$K') LIMIT 1;")
evt_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$EVT" "${H[@]}" \
  -H 'content-type: application/json' \
  -d "{\"device_id\":\"e2e-rl-device\",\"events\":[{\"event_id\":\"e2e-rl-1\",\"config_id\":\"$cid\",\"type\":\"impression\",\"at\":\"2026-10-05T00:00:00Z\"}]}")
check "events still accepted while reads are limited" "202" "$evt_code"

evt_hdrs=$(curl -s -D- -o /dev/null -X POST "$EVT" "${H[@]}" \
  -H 'content-type: application/json' \
  -d "{\"device_id\":\"e2e-rl-device\",\"events\":[{\"event_id\":\"e2e-rl-2\",\"config_id\":\"$cid\",\"type\":\"impression\",\"at\":\"2026-10-05T00:00:00Z\"}]}")
dev_lim=$(printf '%s' "$evt_hdrs" | grep -i '^x-ratelimit-limit:' | tr -d '\r' | awk '{print $2}')
# The 202 is uncached, so the per-device quota it reports is accurate for this caller.
check "the 202 reports the per-device limit (O2: 120)" "120" "$dev_lim"

# ---- the cacheable 200 must NOT carry quota headers -----------------------
# Deliberate: `public, max-age=60` means a shared cache would replay one device's
# remaining count to every other device in the audience tuple.
echo "── the cached read carries no quota headers ──"
bash supabase/tests/psql.sh -c "DELETE FROM public.rate_bucket;" >/dev/null 2>&1
ok_hdrs=$(curl -s -D- -o /dev/null "$CFG?screen=home" "${H[@]}")
n_rl=$(printf '%s' "$ok_hdrs" | grep -ci '^x-ratelimit-' || true)
check "200 omits X-RateLimit-* (would be cached and wrong)" "0" "$n_rl"

# ---- the window rolls -----------------------------------------------------
echo "── the window rolls ──"
for _ in 1 2 3 4; do curl -s -o /dev/null "$CFG?screen=home" "${H[@]}"; done
limited=$(curl -s -o /dev/null -w '%{http_code}' "$CFG?screen=home" "${H[@]}")
check "limited after the burst" "429" "$limited"

bash supabase/tests/psql.sh -c "UPDATE public.rate_bucket SET window_start = now() - interval '61 seconds';" >/dev/null 2>&1
rolled=$(curl -s -o /dev/null -w '%{http_code}' "$CFG?screen=home" "${H[@]}")
check "allowed again once the window has passed" "200" "$rolled"

# ---- clean up this run's rows --------------------------------------------
bash supabase/tests/psql.sh -c "
  DELETE FROM public.impression WHERE device_id = 'e2e-rl-device';
  DELETE FROM public.rate_bucket;" >/dev/null 2>&1

echo ""
[ "$fail" -eq 0 ] && echo "✓ rate-limit e2e passed" || echo "✗ rate-limit e2e FAILED"
exit $fail
