import "server-only";
import { env } from "@/server/env";
import { openRouterProvider } from "./openrouter";

/** Model and fallback come from config, so they change without code (ARCHITECTURE 7). */
export const defaultProvider = () => openRouterProvider({ apiKey: env.OPENROUTER_API_KEY, models: [env.OPENROUTER_MODEL, env.OPENROUTER_FALLBACK_MODEL] });
