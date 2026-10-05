-- ============================================================
-- 008_rate_limit.sql — shared-state rate limiting (spec §8.2, open decision O2)
-- ============================================================
-- O2's defaults: 60 req/min/key for reads, 600/min for events, 120/min per device.
--
-- WHY THIS LIVES IN POSTGRES AND NOT IN THE EDGE FUNCTION
-- A Deno isolate's memory is per-instance and Supabase runs many, so an in-isolate
-- counter divides the real limit by however many isolates happen to be warm — a
-- "60/min" limit that admits 60 × N. PayCraft's lib/edge-rate-limit.ts is exactly that
-- shape and is honest about it: it sheds abusive bursts, it is not a quota. A quota
-- needs state every isolate shares, and the only such state already on this request's
-- path is the database.
--
-- The cost is one extra round trip per uncached request. /v1/configs already makes two
-- (key lookup, config query), and its 60s edge cache means a hit never reaches here at
-- all — so the limiter only charges requests that were going to query anyway.
--
-- CEILING: this is a FIXED window, not a sliding one. A caller can therefore send
-- `limit` requests in the last instant of one window and `limit` again in the first
-- instant of the next — a 2× burst across a boundary. That is an accepted ceiling for
-- abuse shedding; a sliding window needs either a sorted set per subject or a second
-- bucket, and neither is worth the write amplification until someone demonstrates the
-- boundary burst actually hurts. Upgrade path: two half-width buckets, weighted.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rate_bucket (
    -- Opaque, caller-composed: 'key:<uuid>:read' | 'key:<uuid>:events' | 'device:<app_id>:<device_id>'.
    -- Deliberately NOT a FK to app_key: a bucket must survive key revocation, or revoking
    -- a key would hand the abuser a fresh quota.
    subject      text        PRIMARY KEY,
    window_start timestamptz NOT NULL DEFAULT now(),
    count        int         NOT NULL DEFAULT 0 CHECK (count >= 0)
);

-- Device subjects are unbounded in cardinality, so rows accumulate even though each
-- window rolls in place. This index is what makes the purge cheap.
CREATE INDEX IF NOT EXISTS rate_bucket_window_start_idx ON public.rate_bucket (window_start);

-- No policies, deliberately: only service_role (which bypasses RLS) has any business
-- here. RLS is enabled rather than left off so that a future default-privilege grant to
-- `authenticated` cannot turn this into a readable table — enabling it fails closed.
ALTER TABLE public.rate_bucket ENABLE ROW LEVEL SECURITY;

-- Supabase's default ACLs grant table privileges to anon/authenticated on new tables in
-- `public`. Migration 001 swept the tables that existed THEN; this one did not exist yet.
REVOKE ALL ON TABLE public.rate_bucket FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rate_bucket TO service_role;

-- ------------------------------------------------------------
-- consume_rate_limit — count one request against a subject's window.
-- ------------------------------------------------------------
-- Atomic by construction: the INSERT ... ON CONFLICT DO UPDATE is a single statement, so
-- two concurrent callers cannot both read `count = 59` and both write 60. A
-- read-then-write in the Edge Function could, and under exactly the burst the limiter
-- exists to stop.
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
    p_subject         text,
    p_limit           int,
    p_window_seconds  int
)
RETURNS TABLE (allowed boolean, remaining int, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_window interval := make_interval(secs => p_window_seconds);
    v_start  timestamptz;
    v_count  int;
BEGIN
    IF p_limit <= 0 THEN
        -- A non-positive limit means "no quota configured"; admitting the request is the
        -- safe reading. Refusing would let a bad config row black out a tenant.
        RETURN QUERY SELECT true, 0, now();
        RETURN;
    END IF;

    INSERT INTO public.rate_bucket AS rb (subject, window_start, count)
    VALUES (p_subject, now(), 1)
    ON CONFLICT (subject) DO UPDATE
        SET window_start = CASE
                WHEN rb.window_start + v_window <= now() THEN now()
                ELSE rb.window_start
            END,
            count = CASE
                WHEN rb.window_start + v_window <= now() THEN 1
                ELSE rb.count + 1
            END
    RETURNING rb.window_start, rb.count INTO v_start, v_count;

    RETURN QUERY SELECT
        v_count <= p_limit,
        GREATEST(0, p_limit - v_count),
        v_start + v_window;
END $$;

-- ------------------------------------------------------------
-- purge_rate_buckets — bounded growth for device subjects.
-- ------------------------------------------------------------
-- Not called opportunistically from consume_rate_limit: that would add a DELETE scan to
-- the hot path of every request to save a nightly job. Needs scheduling (pg_cron, or the
-- same scheduler O3's 90-day impression retention will need); until it is scheduled the
-- table grows by one row per distinct device per app, which is bounded by the install
-- base and small.
CREATE OR REPLACE FUNCTION public.purge_rate_buckets(p_older_than interval DEFAULT interval '1 hour')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deleted bigint;
BEGIN
    DELETE FROM public.rate_bucket WHERE window_start < now() - p_older_than;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END $$;

-- ------------------------------------------------------------
-- Routine grants — the REVOKE/GRANT pair 007 warned a later migration must carry.
-- ------------------------------------------------------------
-- 007's sweep already ran, so it cannot cover these. Measured without this block on a
-- clean chain: both functions landed with `=X/postgres` in proacl — an EMPTY GRANTEE,
-- which is the PUBLIC pseudo-role — so `anon` and `authenticated` both held EXECUTE via
-- inheritance with no grant naming either, and harness_test.sql failed with
-- "anon can EXECUTE 2 routine(s) in public". That is the same PUBLIC-inheritance hole
-- that made migration 001's first draft a no-op.
--
-- service_role ONLY. The dashboard (`authenticated`) never calls these: rate limiting is
-- enforced on the SDK's path, and a purge is an operator/scheduler action.
REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_rate_limit(text, int, int) TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_rate_buckets(interval) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_rate_buckets(interval) TO service_role;
