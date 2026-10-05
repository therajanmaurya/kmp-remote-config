#!/usr/bin/env bash
# Seeds the LOCAL stack with one app, one key and one enabled config so the Edge Function
# routes can be exercised with curl. Idempotent.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
bash supabase/tests/psql.sh supabase/tests/seed_local.sql
printf 'pk_live_LOCALTESTKEY0000000000000000000'
