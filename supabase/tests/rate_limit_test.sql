-- ============================================================
-- rate_limit_test.sql — consume_rate_limit's window arithmetic (migration 008)
-- ============================================================
-- The limiter is the one piece of this product whose bugs are invisible in normal use:
-- a limit that never trips looks exactly like traffic under the limit, and a limit that
-- trips too early looks like someone else's outage. So every boundary is asserted
-- explicitly, and the window roll is driven by backdating a row rather than by sleeping.
-- ============================================================

DO $$
DECLARE
    r        record;
    i        int;
    v_subject text := 'test:subject:a';
BEGIN
    DELETE FROM public.rate_bucket WHERE subject LIKE 'test:%';

    -- ---- 1. first call is allowed and reports the right remainder ----
    SELECT * INTO r FROM public.consume_rate_limit(v_subject, 3, 60);
    IF NOT r.allowed THEN
        RAISE EXCEPTION 'FAIL: first call against an empty bucket was denied';
    END IF;
    IF r.remaining <> 2 THEN
        RAISE EXCEPTION 'FAIL: after 1 of 3, remaining = % (expected 2)', r.remaining;
    END IF;

    -- ---- 2. the limit itself is INCLUSIVE; limit+1 is the first denial ----
    SELECT * INTO r FROM public.consume_rate_limit(v_subject, 3, 60);   -- 2nd
    SELECT * INTO r FROM public.consume_rate_limit(v_subject, 3, 60);   -- 3rd
    IF NOT r.allowed THEN
        RAISE EXCEPTION 'FAIL: the 3rd of 3 was denied — the limit must be inclusive, or a documented "60/min" actually permits 59';
    END IF;
    IF r.remaining <> 0 THEN
        RAISE EXCEPTION 'FAIL: at the limit, remaining = % (expected 0)', r.remaining;
    END IF;

    SELECT * INTO r FROM public.consume_rate_limit(v_subject, 3, 60);   -- 4th
    IF r.allowed THEN
        RAISE EXCEPTION 'FAIL: the 4th of 3 was ALLOWED — the limiter does not limit';
    END IF;
    IF r.remaining <> 0 THEN
        RAISE EXCEPTION 'FAIL: over the limit, remaining = % (expected 0, never negative)', r.remaining;
    END IF;

    -- ---- 3. counting continues past the limit without going negative ----
    FOR i IN 1..5 LOOP
        SELECT * INTO r FROM public.consume_rate_limit(v_subject, 3, 60);
    END LOOP;
    IF r.remaining < 0 THEN
        RAISE EXCEPTION 'FAIL: remaining went negative (%) — a client reading this header would compute a nonsense backoff', r.remaining;
    END IF;

    -- ---- 4. a separate subject has its own quota ----
    SELECT * INTO r FROM public.consume_rate_limit('test:subject:b', 3, 60);
    IF NOT r.allowed OR r.remaining <> 2 THEN
        RAISE EXCEPTION 'FAIL: subject B was affected by subject A (allowed=%, remaining=%) — subjects must not share a bucket',
            r.allowed, r.remaining;
    END IF;

    -- ---- 5. the window rolls: backdate past the window and the count restarts ----
    -- Backdating rather than sleeping: a pg_sleep(61) would make the suite unrunnable,
    -- and the arithmetic under test is `window_start + window <= now()`, which does not
    -- care how the row got old.
    UPDATE public.rate_bucket SET window_start = now() - interval '61 seconds' WHERE subject = v_subject;
    SELECT * INTO r FROM public.consume_rate_limit(v_subject, 3, 60);
    IF NOT r.allowed THEN
        RAISE EXCEPTION 'FAIL: the window did not roll — a limited caller would stay limited forever';
    END IF;
    IF r.remaining <> 2 THEN
        RAISE EXCEPTION 'FAIL: after the roll, remaining = % (expected 2 — the count must RESTART at 1, not resume)', r.remaining;
    END IF;

    -- ---- 6. a row INSIDE the window does not roll ----
    UPDATE public.rate_bucket SET window_start = now() - interval '30 seconds', count = 3 WHERE subject = v_subject;
    SELECT * INTO r FROM public.consume_rate_limit(v_subject, 3, 60);
    IF r.allowed THEN
        RAISE EXCEPTION 'FAIL: a bucket 30s into a 60s window rolled early — the limit is trivially bypassed by waiting half a window';
    END IF;

    -- ---- 7. reset_at is the END of the current window, not now() ----
    UPDATE public.rate_bucket SET window_start = now() - interval '10 seconds', count = 1 WHERE subject = v_subject;
    SELECT * INTO r FROM public.consume_rate_limit(v_subject, 3, 60);
    IF r.reset_at <= now() THEN
        RAISE EXCEPTION 'FAIL: reset_at (%) is not in the future — Retry-After would be <= 0 and a client would hot-loop', r.reset_at;
    END IF;
    IF r.reset_at > now() + interval '60 seconds' THEN
        RAISE EXCEPTION 'FAIL: reset_at (%) is more than one window away — a client would back off far longer than needed', r.reset_at;
    END IF;

    -- ---- 8. a non-positive limit admits rather than blacks out ----
    SELECT * INTO r FROM public.consume_rate_limit('test:subject:zero', 0, 60);
    IF NOT r.allowed THEN
        RAISE EXCEPTION 'FAIL: limit 0 denied the request — a bad rate_limit_per_min row must not black out a tenant';
    END IF;

    DELETE FROM public.rate_bucket WHERE subject LIKE 'test:%';
    RAISE NOTICE 'PASS: consume_rate_limit — inclusive limit, no negative remainder, per-subject isolation, window roll, reset_at bounds';
END $$;

-- ============================================================
-- The bucket table is service_role-only.
-- ============================================================
-- Table privileges on a new table in `public` come from Supabase's default ACLs, which
-- grant to anon/authenticated — migration 001 swept the tables that existed then, and
-- this one did not. The same PUBLIC-inheritance hole as the routine grants.
DO $$
BEGIN
    IF has_table_privilege('anon', 'public.rate_bucket', 'SELECT') THEN
        RAISE EXCEPTION 'FAIL: anon can SELECT rate_bucket — device_id values are in the subject column';
    END IF;
    IF has_table_privilege('authenticated', 'public.rate_bucket', 'SELECT')
       OR has_table_privilege('authenticated', 'public.rate_bucket', 'UPDATE') THEN
        RAISE EXCEPTION 'FAIL: authenticated can read or write rate_bucket — an operator could clear their own quota';
    END IF;
    IF NOT has_table_privilege('service_role', 'public.rate_bucket', 'INSERT') THEN
        RAISE EXCEPTION 'FAIL: service_role cannot INSERT rate_bucket — the limiter cannot function';
    END IF;

    RAISE NOTICE 'PASS: rate_bucket is service_role-only';
END $$;
