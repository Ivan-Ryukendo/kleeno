import "server-only";
import { z } from "zod";
import { AI_DAILY_TOKEN_LIMIT, AiBudgetExhausted } from "@/core/ai/budget";
import { db } from "./client";

/** Atomic reservation before each HTTP attempt. Uncertain/failed calls are never refunded. */
export async function reserveCompanyAiTokens(companyId: string, tokens: number): Promise<void> {
  z.uuid().parse(companyId);
  z.number().int().positive().max(AI_DAILY_TOKEN_LIMIT).parse(tokens);
  const { data, error } = await db().rpc("reserve_ai_tokens", { p_company_id: companyId, p_tokens: tokens });
  if (error) throw new Error("AI budget reservation unavailable");
  if (data === null) throw new AiBudgetExhausted();
  z.number().int().min(tokens).max(AI_DAILY_TOKEN_LIMIT).parse(data);
}
