import "server-only";
import { renderMessages, type AiProvider } from "@/core/ai";

// OpenRouter adapter (ARCHITECTURE 7). Sends only what core/ai/inputs built; JSON-schema structured output; routing is
// limited to providers that support those parameters and do not retain data. Primary model, then the fallback; if both
// fail it throws and the pipeline records NEEDS_HUMAN_REVIEW. Errors are generic: SDK/HTTP text can echo secrets (S45).
const URL_ = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 90_000; // reasoning models can take a minute; up to three calls per request, within the platform default (300 s)

export function openRouterProvider(opts: { apiKey: string; models: string[]; fetchFn?: typeof fetch }): AiProvider {
  const call = opts.fetchFn ?? fetch;
  return {
    name: "openrouter",
    async complete(req) {
      for (const model of opts.models) {
        try {
          const res = await call(URL_, {
            method: "POST",
            headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({
              model,
              messages: renderMessages(req),
              temperature: 0,
              response_format: { type: "json_schema", json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema } },
              provider: { require_parameters: true, data_collection: "deny" },
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (!res.ok) continue;
          const text = ((await res.json()) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
          if (typeof text === "string" && text) return { text, model };
        } catch {
          // try the fallback model
        }
      }
      throw new Error("ai provider unavailable");
    },
  };
}
