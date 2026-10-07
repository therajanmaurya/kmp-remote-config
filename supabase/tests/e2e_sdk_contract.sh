#!/usr/bin/env bash
# Phase 01 / T5 — does the DEPLOYED control plane still speak the shipped SDK's wire shape?
#
#   bash supabase/tests/e2e_sdk_contract.sh
#
# Seeds a sentinel key + config on PROD, fetches through the real /v1-configs edge function,
# parses the captured body with the production RemoteConfigEnvelope (LiveWireParseTest), then
# removes everything it created. Idempotent: a re-run upserts the same two sentinel rows, and
# the EXIT trap removes them even on failure.
#
# Why prod and not a local stack: the drift this catches is a migration applied to the deployed
# project but never reflected in the committed contract. A local stack is built FROM the
# committed migrations, so by construction it cannot disagree with them — only the live plane can.
#
# Secret handling: the service_role key is resolved to a 0600 file and referenced through a
# curl config file, never an argv (visible in `ps`) and never stdout. Per
# RULE-SECRETS-NO-VALUE-EGRESS-001 nothing here prints a secret value.
set -uo pipefail
# Walk up to the framework root rather than counting `../` — this file sits six levels deep
# inside a submodule inside a workspace, and a miscounted hop silently resolves secrets-get.sh
# to a path that does not exist, which then reads as "cannot resolve from vault".
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
FW=$REPO
while [ "$FW" != "/" ] && [ ! -f "$FW/core/scripts/secrets-get.sh" ]; do FW=$(dirname "$FW"); done
[ -f "$FW/core/scripts/secrets-get.sh" ] || { echo "e2e-sdk: framework root not found above $REPO" >&2; exit 2; }
cd "$REPO" || exit 2

# Public: the project ref ships inside every client binary and is the SDK's DEFAULT_BASE_URL.
PROJECT_REF="gohifhjcvsawcdhcpbkw"
REST="https://$PROJECT_REF.supabase.co/rest/v1"
AUTH="https://$PROJECT_REF.supabase.co/auth/v1"
FUNC="https://$PROJECT_REF.supabase.co/functions/v1/v1-configs"

SENTINEL_SLUG="e2e-sdk-contract"
SENTINEL_KEY="rck_test_E2ESDKCONTRACT0000000000000000"
SENTINEL_BUNDLE="com.rconfig.e2e.sentinel"
SENTINEL_TMPL="announcement"

WORK=$(mktemp -d); chmod 700 "$WORK"
fail=0
cleanup() {
  # Delete the sentinel APP only: app_key and config both declare
  # `REFERENCES public.app(id) ON DELETE CASCADE`, so one request cannot leave a
  # half-removed sentinel behind even if this script dies mid-run.
  if [ -s "$WORK/curlrc" ]; then
    curl -s -K "$WORK/curlrc" -X DELETE "$REST/app?slug=eq.$SENTINEL_SLUG" >/dev/null 2>&1
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

check() { printf '  %-58s ' "$1"; if [ "$2" = "$3" ]; then echo "PASS"; else echo "FAIL (expected $2, got $3)"; fail=1; fi; }

# ---- credentials ----------------------------------------------------------------
# Two sources, in order. CI has no vault, so it passes the value as an env var propagated by
# `/secrets sync-to-ci`; locally the vault is the single source of truth and the env var is
# absent. Either way the value lands in a 0600 file and is never echoed.
umask 077
if [ -n "${RC_SERVICE_ROLE_KEY:-}" ]; then
  printf '%s' "$RC_SERVICE_ROLE_KEY" > "$WORK/srk"
else
  bash "$FW/core/scripts/secrets-get.sh" kmp-remote-config-supabase-service-role-key \
       --to-file "$WORK/srk" || { echo "e2e-sdk: cannot resolve service_role (vault or RC_SERVICE_ROLE_KEY)" >&2; exit 3; }
fi
[ -s "$WORK/srk" ] || { echo "e2e-sdk: resolved service_role file is empty" >&2; exit 3; }

# A curl config FILE keeps the key out of argv, where `ps` would show it. `printf` is a shell
# builtin, so the value never becomes a process argument on the way in either. The vault file
# carries a trailing newline; inside a quoted header value that makes curl send a malformed
# header and no credential at all, which surfaces as a baffling 401 — so strip it first.
umask 077
SRK=$(tr -d '\r\n' < "$WORK/srk")
printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\nheader = "Prefer: resolution=merge-duplicates"\n' \
       "$SRK" "$SRK" > "$WORK/curlrc"
unset SRK

# ---- own the sentinel app with a real operator ----------------------------------
# `app.owner_id` is NOT NULL REFERENCES auth.users(id), so the sentinel needs a real user.
# Resolved from the project rather than hardcoded: a pinned uuid would break the moment this
# ran against a different environment. This script never CREATES a user.
OWNER=$(curl -s -K "$WORK/curlrc" "$AUTH/admin/users?per_page=1" \
        | sed -n 's/.*"users":\[{"id":"\([^"]*\)".*/\1/p')
[ -n "$OWNER" ] || { echo "e2e-sdk: no auth user on $PROJECT_REF to own a sentinel app" >&2; exit 4; }

APP_ID=$(curl -s -K "$WORK/curlrc" -X POST "$REST/app?on_conflict=owner_id,slug" \
  -H "Prefer: return=representation" -d "$(cat <<JSON
{"owner_id":"$OWNER","slug":"$SENTINEL_SLUG","display_name":"e2e sdk contract (sentinel)","platforms":["android"]}
JSON
)" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$APP_ID" ] || { echo "e2e-sdk: could not upsert the sentinel app" >&2; exit 5; }

echo "e2e-sdk-contract → $PROJECT_REF (sentinel app ${APP_ID:0:8}…)"

# ---- seed the sentinel key + config --------------------------------------------
curl -s -K "$WORK/curlrc" -X POST "$REST/app_key" -d "$(cat <<JSON
{"app_id":"$APP_ID","key":"$SENTINEL_KEY","label":"e2e-sdk-contract sentinel","environment":"test",
 "platform":"android","bundle_id":"$SENTINEL_BUNDLE","cert_digests":[],"attestation_policy":"off"}
JSON
)" -o "$WORK/key_seed.json" -w '%{http_code}' > "$WORK/key_code"
kc=$(cat "$WORK/key_code")
case "$kc" in 20*) : ;; *) echo "  seed app_key → HTTP $kc"; sed -n '1,3p' "$WORK/key_seed.json"; exit 5 ;; esac

curl -s -K "$WORK/curlrc" -X POST "$REST/config" -d "$(cat <<JSON
{"app_id":"$APP_ID","template_id":"$SENTINEL_TMPL",
 "payload":{"title":"e2e sentinel","body":"seeded by e2e_sdk_contract.sh","_sentinel":"e2e_sdk_contract"},
 "display":"dialog","screens":[],"platforms":["android"],"priority":0,"is_enabled":true,
 "max_impressions":0,"cooldown_hours":0,"is_dismissible":true}
JSON
)" -o "$WORK/cfg_seed.json" -w '%{http_code}' > "$WORK/cfg_code"
cc=$(cat "$WORK/cfg_code")
case "$cc" in 20*) : ;; *) echo "  seed config → HTTP $cc"; sed -n '1,3p' "$WORK/cfg_seed.json"; exit 5 ;; esac

# ---- fetch through the real edge function, as the SDK does ----------------------
# Headers mirror RemoteConfigService.identityHeaders() exactly. X-RC-SDK-Version is required:
# without it the function answers 403 sdk_version_missing rather than an empty set.
code=$(curl -s -o "$WORK/body.json" -w '%{http_code}' "$FUNC" \
  -H "X-RC-Key: $SENTINEL_KEY" \
  -H "X-RC-Package: $SENTINEL_BUNDLE" \
  -H "X-RC-Platform: android" \
  -H "X-RC-App-Version: 5.0.0" \
  -H "X-RC-SDK-Version: 5.0.0")
check "deployed /v1-configs answers 200 for a valid test key" 200 "$code"
if [ "$code" != "200" ]; then echo "  body: $(head -c 300 "$WORK/body.json")"; exit "$fail"; fi

# A freshly seeded config is a DRAFT. Assert the gate holds BEFORE asserting delivery:
# nothing published means nothing served, which is the fail-closed half of G-3.
n=$(grep -o '"id"' "$WORK/body.json" | wc -l | tr -d ' ')
check "an unpublished app serves nothing (G-3 fail-closed)" 0 "$n"

curl -s -K "$WORK/curlrc" -X POST "$REST/rpc/publish" -d "{\"p_app\":\"$APP_ID\"}" -o "$WORK/pub0.json" >/dev/null 2>&1
code=$(curl -s -o "$WORK/body.json" -w '%{http_code}' "$FUNC" \
  -H "X-RC-Key: $SENTINEL_KEY" -H "X-RC-Package: $SENTINEL_BUNDLE" \
  -H "X-RC-Platform: android" -H "X-RC-App-Version: 5.0.0" -H "X-RC-SDK-Version: 5.0.0")
n=$(grep -o '"id"' "$WORK/body.json" | wc -l | tr -d ' ')
check "after Publish the sentinel config is delivered" 1 "$n"

# ---- G-3: the publish gate holds against the DEPLOYED function -------------------
# The safety assertion of Phase 02. An edit must be invisible to devices until someone
# presses Publish; today the endpoint reads live `config` rows, so the first check FAILS and
# that failure is the proof the gap is real.
title_now() { curl -s "$FUNC" \
    -H "X-RC-Key: $SENTINEL_KEY" -H "X-RC-Package: $SENTINEL_BUNDLE" \
    -H "X-RC-Platform: android" -H "X-RC-App-Version: 5.0.0" -H "X-RC-SDK-Version: 5.0.0" \
  | sed -n 's/.*"title":"\([^"]*\)".*/\1/p'; }

# Edit the draft WITHOUT publishing.
curl -s -K "$WORK/curlrc" -X PATCH "$REST/config?app_id=eq.$APP_ID" \
  -d '{"payload":{"title":"UNPUBLISHED EDIT","body":"must not reach a device","_sentinel":"e2e_sdk_contract"}}' \
  >/dev/null 2>&1

check "an unpublished edit does NOT reach devices (G-3)" "e2e sentinel" "$(title_now)"

# Publish it, and only now may the device see it.
curl -s -K "$WORK/curlrc" -X POST "$REST/rpc/publish" -d "{\"p_app\":\"$APP_ID\"}" -o "$WORK/pub2.json" >/dev/null 2>&1
check "after Publish the new value IS served (G-3)" "UNPUBLISHED EDIT" "$(title_now)"

# ---- G-4: rollback is a new version, and devices follow it ----------------------
# publish_test.sql already proves the TABLE semantics (3 rows, v2 intact, v3 == v1). This
# asserts the half that matters to a user: after a rollback the DEVICE gets the old payload
# back. A rollback that is correct in the database and invisible on devices is not a rollback.
rb=$(curl -s -K "$WORK/curlrc" -X POST "$REST/rpc/rollback_to" \
      -d "{\"p_app\":\"$APP_ID\",\"p_version\":1}")
check "rollback_to(1) returns a NEW version number" 3 "$rb"
check "devices receive v1's payload again after rollback (G-4a)" "e2e sentinel" "$(title_now)"

n_versions=$(curl -s -K "$WORK/curlrc" \
  "$REST/config_version?app_id=eq.$APP_ID&select=version" | grep -o '"version"' | wc -l | tr -d ' ')
check "the undone version is still in history (G-4b)" 3 "$n_versions"

# ---- G-5: typed parameters resolve for this caller's audience -------------------
# Seeded against the sentinel app, so the assertion proves the DEPLOYED function calls
# resolve_parameters and the condition actually matched this caller's platform.
pid=$(curl -s -K "$WORK/curlrc" -X POST "$REST/parameter" -H "Prefer: return=representation" \
  -d "{\"app_id\":\"$APP_ID\",\"key\":\"welcome_banner_enabled\",\"type\":\"boolean\",\"default_value\":false}" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
cid=$(curl -s -K "$WORK/curlrc" -X POST "$REST/condition" -H "Prefer: return=representation" \
  -d "{\"app_id\":\"$APP_ID\",\"name\":\"Android\",\"predicate\":{\"platforms\":[\"android\"]},\"priority\":10}" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
curl -s -K "$WORK/curlrc" -X POST "$REST/parameter_value" \
  -d "{\"parameter_id\":\"$pid\",\"condition_id\":\"$cid\",\"value\":true,\"priority\":1}" >/dev/null 2>&1

curl -s -o "$WORK/body.json" "$FUNC" \
  -H "X-RC-Key: $SENTINEL_KEY" -H "X-RC-Package: $SENTINEL_BUNDLE" \
  -H "X-RC-Platform: android" -H "X-RC-App-Version: 5.0.0" -H "X-RC-SDK-Version: 5.0.0"
has_true=$(grep -c '"welcome_banner_enabled":true' "$WORK/body.json" || true)
check "an android caller gets the condition's value, not the default (G-5)" 1 "$has_true"

curl -s -K "$WORK/curlrc" -X POST "$REST/parameter" \
  -d "{\"app_id\":\"$APP_ID\",\"key\":\"max_uploads\",\"type\":\"number\",\"default_value\":5}" >/dev/null 2>&1
curl -s -o "$WORK/body2.json" "$FUNC" \
  -H "X-RC-Key: $SENTINEL_KEY" -H "X-RC-Package: $SENTINEL_BUNDLE" \
  -H "X-RC-Platform: android" -H "X-RC-App-Version: 5.0.0" -H "X-RC-SDK-Version: 5.0.0"
has_default=$(grep -c '"max_uploads":5' "$WORK/body2.json" || true)
check "a parameter with no matching condition serves its default (G-5)" 1 "$has_default"

# ---- parse the LIVE body with the shipped model ---------------------------------
( cd "$REPO" && ./gradlew --quiet :cmp-remote-config:jvmTest \
    --tests '*LiveWireParseTest*' -Drc.live.body="$WORK/body.json" --rerun-tasks ) > "$WORK/parse.log" 2>&1
pc=$?
check "shipped RemoteConfigEnvelope parses the live body (strict)" 0 "$pc"
[ "$pc" -ne 0 ] && grep -E "LiveWireParse|AssertionError|Unknown key|SerializationException" "$WORK/parse.log" | head -5

[ "$fail" -eq 0 ] && echo "✓ e2e-sdk-contract: deployed plane matches the shipped wire model" \
                  || echo "✗ e2e-sdk-contract FAILED" >&2
exit "$fail"
