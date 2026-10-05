#!/usr/bin/env bash
# =============================================================================
# psql.sh — run a .sql file (or inline SQL) against the LOCAL Supabase stack.
# =============================================================================
# Resolves the connection from `supabase status` instead of hardcoding it.
#
# Why not just write the DSN inline: the local Supabase credential is fixed and
# publicly documented, so it is not a secret — but it MATCHES the secrets output
# guard's postgres-url-with-credentials pattern, and a guard that fires on every
# test run teaches you to ignore it. Resolving at run time keeps the literal out
# of logs and transcripts entirely.
#
# Usage:
#   bash supabase/tests/psql.sh path/to/file.sql
#   bash supabase/tests/psql.sh -c "SELECT 1;"
#   bash supabase/tests/psql.sh -t "SELECT 1;"   # tuples only, for scripted assertions
#   DB_URL=$(bash supabase/tests/psql.sh --print-url)   # for callers that need it
#
# Exit: psql's own status. ON_ERROR_STOP is always on, so a RAISE EXCEPTION in a
# test file fails the run rather than printing and continuing.
# =============================================================================
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

resolve_url() {
    # `supabase status -o env` emits DB_URL="postgresql://..." among others.
    local line
    line=$(supabase status -o env 2>/dev/null | grep -E '^DB_URL=' | head -1) || true
    if [ -z "$line" ]; then
        echo "psql.sh: could not resolve DB_URL from \`supabase status\` — is the stack running? (\`supabase start\`)" >&2
        return 3
    fi
    # strip  DB_URL=  and any surrounding quotes
    line="${line#DB_URL=}"
    line="${line%\"}"
    line="${line#\"}"
    printf '%s' "$line"
}

URL=$(resolve_url) || exit $?

case "${1:-}" in
    --print-url) printf '%s\n' "$URL" ;;
    -c)          shift; psql "$URL" -v ON_ERROR_STOP=1 -q -c "$*" ;;
    # Tuples-only: a bare value with no header or row count, so a shell test can compare it
    # directly. Without this, callers passed `-t -c` and it was read as a filename.
    -t)          shift; psql "$URL" -v ON_ERROR_STOP=1 -q -t -A -c "$*" ;;
    "")          echo "psql.sh: need a .sql path, -c \"<sql>\", or --print-url" >&2; exit 2 ;;
    *)           psql "$URL" -v ON_ERROR_STOP=1 -f "$1" ;;
esac
