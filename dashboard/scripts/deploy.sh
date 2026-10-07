#!/usr/bin/env bash
# =============================================================================
# deploy.sh — build with the PUBLIC Supabase config inlined, then upload.
# =============================================================================
# `NEXT_PUBLIC_*` is inlined by Next at BUILD time, so a build run from a shell that lacks
# them produces a bundle whose `createClient()` throws on every page load. Nothing about that
# build fails: `next build` exits 0, the upload succeeds, every route still returns 200, and
# the only symptom is a sign-in button stuck on "Redirecting to Google…".
#
# That shipped. `npm run pages:deploy` was being run directly, which is why this script exists
# and why `pages:deploy` now points at it: the env resolution cannot be a step someone
# remembers, it has to be the only path.
#
# Values come from the vault by the aliases in `cloudflare-secrets.map`, never from a .env file
# (SV18 forbids one on this project) and never echoed (SV32).
set -uo pipefail

DASH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DASH_DIR" || exit 2

# Walk up to the framework root rather than counting `../` — this lives inside a submodule
# inside a workspace, and a miscounted hop resolves secrets-get.sh to a path that does not
# exist, which then reads as "cannot resolve from vault".
FW="$DASH_DIR"
while [ "$FW" != "/" ] && [ ! -f "$FW/core/scripts/secrets-get.sh" ]; do FW=$(dirname "$FW"); done
[ -f "$FW/core/scripts/secrets-get.sh" ] || { echo "❌ framework root not found above $DASH_DIR" >&2; exit 2; }

WORK=$(mktemp -d); chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
umask 077

# Writes to a file and prints NOTHING. An earlier version returned the value on stdout and was
# called as `V=$(resolve ...)` — where its `exit 3` ran in the command-substitution SUBSHELL and
# could not stop the script. A failed resolve therefore produced an EMPTY variable, the build
# ran without it, and the only thing that caught it was the bundle gate below. Same footgun as
# `rc=$?` after an `if`: the status never reaches the caller.
resolve() { # $1 = vault alias, $2 = name for the error message
  # Resolved from the FRAMEWORK ROOT: secrets-get.sh is CWD-dependent, and the identical call
  # that succeeds from there fails from this directory. `/idea-feature-stitch` hit the same
  # thing and shipped stitch-key-resolve.sh to work around it. The subshell keeps the cd local.
  if ! ( cd "$FW" && bash core/scripts/secrets-get.sh "$1" --to-file "$WORK/$1" ) >/dev/null 2>&1; then
    echo "❌ could not resolve $2 ($1) from the vault" >&2
    return 3
  fi
  if [ ! -s "$WORK/$1" ]; then
    echo "❌ $2 ($1) resolved empty" >&2
    return 3
  fi
  return 0
}

read_resolved() { tr -d '\r\n' < "$WORK/$1"; }

echo "▸ resolving public config from the vault…"
resolve kmp-remote-config-supabase-url      "NEXT_PUBLIC_SUPABASE_URL"      || exit 3
resolve kmp-remote-config-supabase-anon-key "NEXT_PUBLIC_SUPABASE_ANON_KEY" || exit 3
resolve mbs-cloudflare-pages-api-token      "CLOUDFLARE_API_TOKEN"          || exit 3

NEXT_PUBLIC_SUPABASE_URL=$(read_resolved kmp-remote-config-supabase-url)
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(read_resolved kmp-remote-config-supabase-anon-key)
CLOUDFLARE_API_TOKEN=$(read_resolved mbs-cloudflare-pages-api-token)
export NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY CLOUDFLARE_API_TOKEN

# Belt and braces in the PARENT shell, where a failure can actually stop the run.
for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY CLOUDFLARE_API_TOKEN; do
  [ -n "${!v}" ] || { echo "❌ $v is empty after resolution" >&2; exit 3; }
done

# Deliberately NOT exported: SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ twin, because a
# NEXT_PUBLIC_ variable reaches every visitor's browser. It is a Worker runtime secret, synced
# separately by secrets-sync-to-cloudflare.sh.

echo "▸ building…"
npm run build >/dev/null || { echo "❌ next build failed" >&2; exit 4; }

# The gate that would have caught the shipped regression. Asserting on the ARTIFACT, not on
# the environment: the question is not "were the variables set" but "did they reach the bundle".
echo "▸ verifying the bundle carries its config…"
npx jest __tests__/bundle-env.test.ts --silent \
  || { echo "❌ the built bundle is missing its Supabase config — refusing to deploy" >&2; exit 5; }

echo "▸ deploying…"
npx @cloudflare/next-on-pages@1 \
  && npx wrangler pages deploy .vercel/output/static --project-name=rconfig --branch=release
