INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111','a@example.test')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.app (id, owner_id, slug, display_name, platforms)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','app-a','App A','{android}')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.app_key (app_id, key, environment, platform, bundle_id)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','pk_live_LOCALTESTKEY0000000000000000000','live','android','com.example.app')
  ON CONFLICT (key) DO NOTHING;
-- A rendering config AND a feature flag, so the response shape is exercised both ways.
INSERT INTO public.config (id, app_id, template_id, payload, display, is_enabled, priority)
VALUES ('cccccccc-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-00000000000a',
        'announcement','{"title":"Hello","body":"World"}','dialog',true,10)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.config (id, app_id, template_id, payload, display, is_enabled, priority)
VALUES ('cccccccc-0000-0000-0000-00000000000f','aaaaaaaa-0000-0000-0000-00000000000a',
        'feature_flag','{"key":"new_search","value":true}','none',true,0)
  ON CONFLICT (id) DO NOTHING;
-- A screen-targeted config, to prove the omitted-screen rule end to end.
INSERT INTO public.config (id, app_id, template_id, payload, display, is_enabled, screens)
VALUES ('cccccccc-0000-0000-0000-00000000005c','aaaaaaaa-0000-0000-0000-00000000000a',
        'information','{"title":"Settings only","body":"x"}','banner',true,'{settings}')
  ON CONFLICT (id) DO NOTHING;
