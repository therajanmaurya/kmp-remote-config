#!/usr/bin/env bash
# Runs every SQL assertion against the LOCAL stack. Exits non-zero on the first failure.
# Order matters: harness proves the hardening posture the rest depend on, and rls_test
# runs last because it asserts the combined effect of every policy above it.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

TESTS=(
  harness_test.sql
  app_test.sql
  app_key_test.sql
  template_test.sql
  config_test.sql
  impression_test.sql
  rate_limit_test.sql
  custom_template_test.sql
  publish_test.sql
  rls_test.sql
)

fail=0
for f in "${TESTS[@]}"; do
  printf '  %-22s ' "$f"
  if out=$(bash supabase/tests/psql.sh "supabase/tests/$f" 2>&1); then
    echo "PASS"
  else
    echo "FAIL"
    printf '%s\n' "$out" | sed 's/^/      /'
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "✓ all ${#TESTS[@]} SQL assertions passed"
else
  echo "✗ SQL assertions FAILED" >&2
fi
exit "$fail"
