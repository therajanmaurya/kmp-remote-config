-- ============================================================
-- app_key — the publishable keys an SDK presents, and the identity bound to each.
-- ============================================================

-- base62 over 32 random draws. gen_random_bytes needs pgcrypto (migration 001).
CREATE OR REPLACE FUNCTION public.generate_publishable_key(p_env text) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  out text := '';
  i int;
BEGIN
  IF p_env NOT IN ('live','test') THEN
    RAISE EXCEPTION 'environment must be live or test, got %', p_env;
  END IF;
  FOR i IN 1..32 LOOP
    out := out || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % 62), 1);
  END LOOP;
  RETURN 'pk_' || p_env || '_' || out;
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
    )
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
