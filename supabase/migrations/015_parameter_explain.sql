-- =============================================================================
-- 015_parameter_explain.sql — "which condition won, and why"
-- =============================================================================
-- `resolve_parameters` answers WHAT a device receives. The parameter editor needs to answer
-- WHICH RULE decided it, which is the question an operator actually asks when a value looks
-- wrong — "my phone is on Android 4.3, why am I getting the default?"
--
-- Implemented by reusing `condition_matches` rather than re-walking the predicate: one
-- definition of what "Android beta" means, so the explanation can never describe a decision
-- different from the one the edge function made. That is the same reason resolution itself
-- lives in SQL (migration 012).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_parameter_explain(p_parameter uuid, p_audience jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_param   public.parameter%ROWTYPE;
    v_win     record;
BEGIN
    SELECT * INTO v_param FROM public.parameter WHERE id = p_parameter;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    -- Authorisation is explicit because SECURITY DEFINER bypasses RLS. Without it, any
    -- authenticated user could explain any tenant's parameter by guessing an id — and the
    -- explanation leaks the condition names and predicates, not just a value.
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND NOT public.is_app_member(v_param.app_id) THEN
        RAISE EXCEPTION 'not authorised to read parameter %', p_parameter USING ERRCODE = '42501';
    END IF;

    SELECT pv.value, c.id AS condition_id, c.name AS condition_name, pv.priority
      INTO v_win
      FROM public.parameter_value pv
      JOIN public.condition c ON c.id = pv.condition_id
     WHERE pv.parameter_id = p_parameter
       AND public.condition_matches(c.predicate, p_audience)
     ORDER BY pv.priority
     LIMIT 1;

    IF NOT FOUND THEN
        -- Falling through to the default is a RESULT, not an absence. Saying so explicitly is
        -- what turns "why am I getting false?" into an answer.
        RETURN jsonb_build_object(
            'found', true,
            'value', v_param.default_value,
            'source', 'default',
            'condition_id', NULL,
            'condition_name', NULL
        );
    END IF;

    RETURN jsonb_build_object(
        'found', true,
        'value', v_win.value,
        'source', 'condition',
        'condition_id', v_win.condition_id,
        'condition_name', v_win.condition_name,
        'priority', v_win.priority
    );
END;
$$;

-- 007's sweep has already run and cannot cover routines created afterwards.
REVOKE EXECUTE ON FUNCTION public.resolve_parameter_explain(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resolve_parameter_explain(uuid, jsonb) TO   authenticated, service_role;
