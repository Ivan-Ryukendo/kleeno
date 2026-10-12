import "server-only";
import { renderMessages, type AiProvider } from "@/core/ai";
import { AI_MAX_OUTPUT_TOKENS, AI_REQUEST_BYTE_LIMIT, AI_RESPONSE_BYTE_LIMIT } from "@/core/ai/budget";
const URL_ = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 40_000; // six fallback/repair attempts fit the 300s platform default
async function boundedJson(res: Response): Promise<unknown> {
  if (!res.body) throw new Error("empty AI response");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > AI_RESPONSE_BYTE_LIMIT) { await reader.cancel(); throw new Error("AI response limit"); }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}
/** Optional reservation port serves offline/owner diagnostics; application defaults always bind the company RPC. */
export function openRouterProvider(opts: { apiKey: string; models: string[]; fetchFn?: typeof fetch; reserve?: (tokens: number) => Promise<void> }): AiProvider {
  const call = opts.fetchFn ?? fetch;
  const models = Object.freeze([...new Set(opts.models)]);
  if (!models.length || models.length > 2 || models.some((m) => !/^[a-zA-Z0-9/_.:-]{1,200}$/.test(m))) throw new Error("invalid AI model pins");
  let attempts = 0, reservedTokens = 0;
  return {
    name: "openrouter", models,
    telemetry: () => ({ version: "ai-bound-v1", attempts, reservedTokens, budgetEnforced: !!opts.reserve, maxOutputTokens: AI_MAX_OUTPUT_TOKENS, pinnedModels: [...models] }),
    async complete(req) {
      for (const model of models) {
        const body = JSON.stringify({
          model, messages: renderMessages(req), temperature: 0, max_tokens: AI_MAX_OUTPUT_TOKENS,
          reasoning: { enabled: false },
          response_format: { type: "json_schema", json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema } },
          provider: { require_parameters: true, data_collection: "deny" },
        });
        const bytes = Buffer.byteLength(body, "utf8");
        if (bytes > AI_REQUEST_BYTE_LIMIT) throw new Error("AI request limit");
        // Serialized UTF8 bytes conservatively cover input tokens. Charge full output even for failures.
        // Outside fallback catch: a breached/unavailable budget must halt all retries.
        if (opts.reserve) { await opts.reserve(bytes + AI_MAX_OUTPUT_TOKENS); reservedTokens += bytes + AI_MAX_OUTPUT_TOKENS; }
        attempts++;
        try {
          const res = await call(URL_, {
            method: "POST", headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
            body, signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (!res.ok) { await res.body?.cancel(); continue; }
          const output = await boundedJson(res) as { model?: unknown; choices?: { message?: { content?: unknown } }[] };
          const text = output.choices?.[0]?.message?.content;
          if (output.model === model && typeof text === "string" && text) return { text, model };
        } catch { /* Never expose provider/HTTP error text (S45). */ }
      }
      throw new Error("ai provider unavailable");
    },
  };
}
