# supabase/ — control plane

The backend half of kmp-remote-config: schema in `migrations/`, Edge Functions in `functions/`.

**Empty on purpose.** The tables that shipped in KmpToolkit's `supabase/` belonged to
`cmp-product-tickets`, not remote config, so they were not carried over. The schema here is new
work: the app + key registry, the template registry, targeting and impressions.

Prior art worth reading before writing the first migration — the pattern this generalizes:
`mbs/reels-downloader/server-layer/supabase-backend/` has `migrations/014_remote_config.sql` plus
`functions/config/index.ts`, where the table is read ONLY through an Edge Function using
`service_role`, with the anon key revoked from the whole `public` schema (`013_rls_hardening.sql`)
and the response edge-cached and fail-soft.

Note the two divergent schemas that already exist in the wild and must be reconciled:

| Schema | Where | Read path |
|---|---|---|
| `product_remote_config` | what `RemoteConfigService` queries today | anon key, direct PostgREST |
| `app_remote_config` | deployed in reels-downloader | `service_role`, via `/config` Edge Function |

The SDK's current anon-PostgREST read path **cannot reach** the deployed one — anon is locked out
schema-wide. Resolving that is part of the control-plane work, not a detail.
