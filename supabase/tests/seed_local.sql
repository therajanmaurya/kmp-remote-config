-- Seeds the LOCAL stack for the e2e script. These rows are COMMITTED, so they use a
-- dedicated id space (d0000000-…) that the transactional SQL tests never touch. Sharing
-- ids made `run.sh` fail with a primary-key collision on a seeded database — the tests
-- insert their own fixtures inside BEGIN/ROLLBACK and cannot see, or avoid, a committed row.
INSERT INTO auth.users (id, email) VALUES ('d0000000-0000-0000-0000-00000000d001','seed@example.test')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.app (id, owner_id, slug, display_name, platforms)
VALUES ('d0000000-0000-0000-0000-0000000000aa','d0000000-0000-0000-0000-00000000d001','app-a','App A','{android}')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.app_key (app_id, key, environment, platform, bundle_id)
VALUES ('d0000000-0000-0000-0000-0000000000aa','pk_live_LOCALTESTKEY0000000000000000000','live','android','com.example.app')
  ON CONFLICT (key) DO NOTHING;
-- A rendering config AND a feature flag, so the response shape is exercised both ways.
INSERT INTO public.config (id, app_id, template_id, payload, display, is_enabled, priority)
VALUES ('cccccccc-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000aa',
        'announcement','{"title":"Hello","body":"World"}','dialog',true,10)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.config (id, app_id, template_id, payload, display, is_enabled, priority)
VALUES ('cccccccc-0000-0000-0000-00000000000f','d0000000-0000-0000-0000-0000000000aa',
        'feature_flag','{"key":"new_search","value":true}','none',true,0)
  ON CONFLICT (id) DO NOTHING;
-- A screen-targeted config, to prove the omitted-screen rule end to end.
INSERT INTO public.config (id, app_id, template_id, payload, display, is_enabled, screens)
VALUES ('cccccccc-0000-0000-0000-00000000005c','d0000000-0000-0000-0000-0000000000aa',
        'information','{"title":"Settings only","body":"x"}','banner',true,'{settings}')
  ON CONFLICT (id) DO NOTHING;
-- Schedule-window fixtures. Nothing tested starts_at/ends_at, and the route relies on two
-- CHAINED .or() calls being AND-combined by supabase-js — a claim inherited from a comment
-- in reels-downloader's /config function. If they OR-combine instead, an expired config
-- keeps showing and a future one appears early, so this is worth proving rather than trusting.
INSERT INTO public.config (id, app_id, template_id, payload, display, is_enabled, starts_at)
VALUES ('cccccccc-0000-0000-0000-0000000000f1','d0000000-0000-0000-0000-0000000000aa',
        'announcement','{"title":"Not yet","body":"future"}','dialog',true, now() + interval '7 days')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.config (id, app_id, template_id, payload, display, is_enabled, starts_at, ends_at)
VALUES ('cccccccc-0000-0000-0000-0000000000e1','d0000000-0000-0000-0000-0000000000aa',
        'announcement','{"title":"Over","body":"expired"}','dialog',true, now() - interval '30 days', now() - interval '1 day')
  ON CONFLICT (id) DO NOTHING;
