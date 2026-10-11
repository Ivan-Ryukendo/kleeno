BEGIN;
-- Service-only accounting, not payroll data. UTC day and cap are database-owned.
CREATE TABLE public.ai_daily_token_budgets (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  budget_day date NOT NULL,
  reserved_tokens integer NOT NULL CHECK (reserved_tokens BETWEEN 0 AND 200000),
  PRIMARY KEY (company_id, budget_day)
);
ALTER TABLE public.ai_daily_token_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_daily_token_budgets FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ai_daily_token_budgets TO service_role;
-- Definer permits only this bounded increment; service_role cannot reset/decrease counters.
CREATE FUNCTION public.reserve_ai_tokens(p_company_id uuid, p_tokens integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE total integer;
BEGIN
  IF p_company_id IS NULL OR p_tokens IS NULL OR p_tokens < 1 OR p_tokens > 200000 THEN
    RAISE EXCEPTION 'invalid AI budget reservation' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ai_daily_token_budgets AS budget(company_id, budget_day, reserved_tokens)
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
