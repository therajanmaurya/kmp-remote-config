-- ============================================================
-- app_key — the publishable keys an SDK presents, and the identity bound to each.
-- ============================================================

-- Prefix is `rck_` (remote-config key), NOT `pk_`. `pk_live_`/`pk_test_` is byte-identical
-- to Stripe's publishable-key format and the secret-output guard matches it as one: every
-- e2e run, seed read and (eventually) dashboard key listing would raise a false secrets
-- alert. That is the same alert-fatigue argument that moved the local DSN into psql.sh —
-- a guard that cries wolf gets ignored, and then it misses a real leak.
--
-- base62 by REJECTION SAMPLING, not `% 62`. 256 is not a multiple of 62, so a plain modulo
-- makes the first 8 alphabet characters ~25% likelier. It does not matter for a
-- deliberately-public key, but this is the function someone copies when they need a key
-- that IS secret.
CREATE OR REPLACE FUNCTION public.generate_publishable_key(p_env text) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  out text := '';
  b int;
BEGIN
  IF p_env NOT IN ('live','test') THEN
    RAISE EXCEPTION 'environment must be live or test, got %', p_env;
  END IF;
  WHILE length(out) < 32 LOOP
    b := get_byte(gen_random_bytes(1), 0);
    -- 248 = 4*62. Discarding 248..255 leaves a range that divides evenly by 62.
    IF b < 248 THEN
      out := out || substr(alphabet, 1 + (b % 62), 1);
    END IF;
  END LOOP;
  RETURN 'rck_' || p_env || '_' || out;
END $$;

CREATE TABLE IF NOT EXISTS public.app_key (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id             uuid NOT NULL REFERENCES public.app(id) ON DELETE CASCADE,
    -- PLAINTEXT, deliberately: a publishable key ships inside the client binary, so anyone
    -- can extract it. Hashing would protect nothing while preventing the dashboard from
    -- showing a developer the key their own app already contains. The controls that matter
    -- are bundle_id + cert_digests + attestation, not this column's secrecy. (Contrast the
    -- service_role key, which is a real secret and lives only in the vault.)
    key                text NOT NULL UNIQUE,
    label              text,
    environment        text NOT NULL CHECK (environment IN ('live','test')),
    platform           text CHECK (platform IS NULL OR platform IN ('android','ios','desktop','web','wasm')),
    bundle_id          text,
    -- SHA-256 digests, PLURAL. Play App Signing re-signs the upload artifact, so the digest
    -- a developer reads locally is frequently not the shipping one, and Play Integrity
    -- reports SHA-256. A single-value SHA-1 column breaks on the first upload-key rotation.
    cert_digests       text[] NOT NULL DEFAULT '{}',
    attestation_policy text NOT NULL DEFAULT 'preferred'
                           CHECK (attestation_policy IN ('required','preferred','off')),
    rate_limit_per_min int NOT NULL DEFAULT 60 CHECK (rate_limit_per_min > 0),
    revoked_at         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    -- Only android and ios have an attestation API. Requiring it elsewhere would reject
    -- every legitimate request from that platform with no way to satisfy the check.
    CONSTRAINT app_key_attestation_platform CHECK (
        attestation_policy <> 'required' OR platform IN ('android','ios')
    ),
    -- The visible prefix must agree with the environment column. Without this a row can
    -- read `rck_test_…` while being environment='live', so the dashboard shows a key the
    -- operator will reasonably believe is a sandbox key and it is not.
    CONSTRAINT app_key_prefix_matches_env CHECK (key LIKE 'rck_' || environment || '_%')
);

-- Partial index: the Edge Function's only lookup is by key among non-revoked rows.
CREATE INDEX IF NOT EXISTS idx_app_key_lookup ON public.app_key (key) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_key_app    ON public.app_key (app_id);

ALTER TABLE public.app_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_key FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_key TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_publishable_key(text) TO authenticated;

CREATE POLICY app_key_select ON public.app_key FOR SELECT TO authenticated
    USING (public.is_app_member(app_id));
CREATE POLICY app_key_write ON public.app_key FOR ALL TO authenticated
    USING (public.has_app_role(app_id, ARRAY['owner','editor']))
    WITH CHECK (public.has_app_role(app_id, ARRAY['owner','editor']));
