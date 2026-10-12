BEGIN;
-- Internal counters are not public payroll resources; retain reservations and the bounded RPC.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.ai_daily_token_budgets SET SCHEMA private;
REVOKE ALL ON private.ai_daily_token_budgets FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.reserve_ai_tokens(p_company_id uuid, p_tokens integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE total integer;
BEGIN
  IF p_company_id IS NULL OR p_tokens IS NULL OR p_tokens < 1 OR p_tokens > 200000 THEN
    RAISE EXCEPTION 'invalid AI budget reservation' USING ERRCODE = '22023';
  END IF;
  INSERT INTO private.ai_daily_token_budgets AS budget(company_id, budget_day, reserved_tokens)
  VALUES (p_company_id, (statement_timestamp() AT TIME ZONE 'UTC')::date, p_tokens)
  ON CONFLICT (company_id, budget_day) DO UPDATE
    SET reserved_tokens = budget.reserved_tokens + p_tokens
    WHERE budget.reserved_tokens <= 200000 - p_tokens
  RETURNING reserved_tokens INTO total;
  RETURN total;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_ai_tokens(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_tokens(uuid, integer) TO service_role;
COMMIT;
