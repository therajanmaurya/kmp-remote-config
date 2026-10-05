-- Reverse of 008_rate_limit.sql.
--
-- Dropping the limiter removes enforcement, so the routes fail open by construction —
-- consumeRateLimit's RPC errors and admits every request. That is the designed behaviour
-- for an unreachable limiter, so this rollback degrades to "no quota" rather than to a
-- broken read path. Deploy the pre-008 function bundle too if you want the RPC call gone.
DROP FUNCTION IF EXISTS public.purge_rate_buckets(interval);
DROP FUNCTION IF EXISTS public.consume_rate_limit(text, int, int);
DROP TABLE IF EXISTS public.rate_bucket;
