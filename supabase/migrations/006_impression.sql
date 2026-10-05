-- ============================================================
-- impression — per-device delivery state. service_role ONLY.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.impression (
    config_id      uuid NOT NULL REFERENCES public.config(id) ON DELETE CASCADE,
    -- Client-generated, opaque, pseudonymous. Never logged, never in telemetry, never
    -- joined to auth.users.
    device_id      text NOT NULL,
    app_id         uuid NOT NULL REFERENCES public.app(id) ON DELETE CASCADE,
    count          int  NOT NULL DEFAULT 0,
    dismissed      boolean NOT NULL DEFAULT false,
    acked_at       timestamptz,
    acted_at       timestamptz,
    -- Ring-buffered client event ids, for RETRY dedupe. Idempotency is per EVENT, not per
    -- (config, device): dismiss/ack are state transitions, but `impression` INCREMENTS a
    -- counter — a genuine re-show must count while a retry of the first must not. Deduping
    -- on (config_id, device_id, type) would make every impression after the first invisible
    -- and silently cap max_impressions at 1 for every config in the product.
    seen_event_ids text[] NOT NULL DEFAULT '{}',
    first_seen_at  timestamptz NOT NULL DEFAULT now(),
    last_seen_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (config_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_impression_app ON public.impression (app_id);

-- RLS ON + FORCED with NO policy and NO grant: writable only by service_role, which
-- bypasses RLS. The dashboard will read aggregates through a view, never per-device rows.
ALTER TABLE public.impression ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impression FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.impression FROM anon, authenticated;

-- Returns TRUE when the event was applied, FALSE when it was a recognised retry.
-- SECURITY DEFINER so the Edge Function can call it via rpc() without table grants.
-- p_app is the FIRST parameter and is not optional. Deriving app_id from the config row
-- alone (the original design) meant any holder of any valid key could write events against
-- ANY config uuid in the control plane — poisoned counts and forged dismissals under another
-- tenant. Attestation does not catch it either: the attacker presents their own genuine
-- app's assertion, which passes the app-binding check in gate.ts. The tenant boundary has
-- to be enforced HERE, at the one place every caller routes through.
CREATE OR REPLACE FUNCTION public.record_event(
    p_app uuid, p_config uuid, p_device text, p_type text, p_event_id text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_app uuid;
  v_seen text[];
  k_keep constant int := 50;
BEGIN
  IF p_type NOT IN ('impression','dismiss','ack','action') THEN
    RAISE EXCEPTION 'unknown event type %', p_type;
  END IF;
  -- Bounded: device_id is client-supplied and keys a row, so an unbounded value is an
  -- unbounded-storage lever. 200 chars is far above any real opaque device identifier.
  IF p_device IS NULL OR length(p_device) = 0 OR length(p_device) > 200 THEN
    RETURN false;
  END IF;
  -- DELIBERATELY NOT CHECKED: that the config is enabled and inside its schedule window.
  -- A config disabled (or expired) between the moment a client rendered it and the moment it
  -- reports the impression is a NORMAL race, and refusing there would under-count real
  -- deliveries — the opposite of what impression data is for. The row-growth lever this
  -- leaves is bounded by the device_id length cap above and by p_app scoping, so a caller
  -- can only create rows against its OWN configs. Revisit if impression volume ever drives
  -- billing, where over-counting a disabled config would matter.
  --
  -- Unknown OR foreign config: refused as a normal false return, not an exception, so one
  -- bad id in a batch does not discard the device's other queued events. The caller cannot
  -- tell the two cases apart, which is deliberate — it must not be able to probe which
  -- config uuids exist in other tenants.
  SELECT app_id INTO v_app FROM public.config WHERE id = p_config AND app_id = p_app;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.impression (config_id, device_id, app_id)
  VALUES (p_config, p_device, v_app)
  ON CONFLICT (config_id, device_id) DO NOTHING;

  -- FOR UPDATE: two in-flight events for the same (config, device) must serialise, or
  -- concurrent impressions race on seen_event_ids and one silently vanishes.
  SELECT seen_event_ids INTO v_seen FROM public.impression
   WHERE config_id = p_config AND device_id = p_device FOR UPDATE;

  IF p_event_id = ANY(v_seen) THEN
    RETURN false;  -- retry of an event already applied
  END IF;

  UPDATE public.impression SET
    count        = count + CASE WHEN p_type = 'impression' THEN 1 ELSE 0 END,
    dismissed    = dismissed OR (p_type = 'dismiss'),
    acked_at     = CASE WHEN p_type = 'ack'    THEN COALESCE(acked_at, now()) ELSE acked_at END,
    acted_at     = CASE WHEN p_type = 'action' THEN COALESCE(acted_at, now()) ELSE acted_at END,
    last_seen_at = now(),
    seen_event_ids = (ARRAY[p_event_id] || v_seen)[1:k_keep]
  WHERE config_id = p_config AND device_id = p_device;

  RETURN true;
END $$;

-- Callable by service_role only (the Edge Function path). Migration 001 already revoked
-- EXECUTE from PUBLIC; this makes the intent explicit and survives a default-privileges change.
REVOKE ALL ON FUNCTION public.record_event(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_event(uuid, uuid, text, text, text) TO service_role;
