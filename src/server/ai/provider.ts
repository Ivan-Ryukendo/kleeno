import "server-only";
import { env } from "@/server/env";
import { openRouterProvider } from "./openrouter";
import { reserveCompanyAiTokens } from "@/server/db/ai-budget";

/** Model and fallback come from config, so they change without code (ARCHITECTURE 7). */
export const defaultProvider = (companyId: string) => openRouterProvider({ apiKey: env.OPENROUTER_API_KEY, models: [env.OPENROUTER_MODEL, env.OPENROUTER_FALLBACK_MODEL], reserve: (tokens) => reserveCompanyAiTokens(companyId, tokens) });
