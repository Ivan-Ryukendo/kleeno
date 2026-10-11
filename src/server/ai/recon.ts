import "server-only";
import { runValidated, type AiProvider } from "@/core/ai";
import { reconInput, type ReconItem } from "@/core/ai/inputs/recon";
import { RECON_PROMPT_VERSION, RECON_SCHEMA_VERSION, reconSpec, type ReconSuggestion } from "@/core/ai/recon";
import type { Detected, ReconInput } from "@/core/reconciliation";
import { recordExecution } from "@/server/db/ai";
import { defaultProvider } from "./provider";

const MAX_PER_CALL = 40;

/**
 * ReconciliationAgent: proposes which allowed decision fits each exception. Advice only (rule 2): it is stored beside the
 * exception, shown as "Suggested by AI, not applied", and never resolves anything. If the AI is unavailable or answers
 * badly, the exceptions simply have no suggestion; detection never depends on it.
 */
export async function suggestForExceptions(who: { companyId: string; correlationId: string }, fresh: Detected[], input: ReconInput, provider?: AiProvider) {
  const byKey = new Map<string, ReconSuggestion>();
  const batch = fresh.slice(0, MAX_PER_CALL);
  if (batch.length === 0) return { executionId: null, byKey };
  const payTypes = new Map(input.workers.map((w) => [w.id, w.payType]));
  const refs = batch.map((e, i) => ({ ref: `e${i + 1}`, category: e.category, payType: payTypes.get(e.workerId)!, facts: e.evidence.facts, options: [...e.options] })) as ReconItem[];
  const p = provider ?? defaultProvider(who.companyId);
  const result = await runValidated(p, reconSpec(refs), reconInput(refs, `${who.correlationId}`));
  const executionId = await recordExecution(who, { operation: "RECON_CLASSIFY", inputRef: who.correlationId, schemaVersion: RECON_SCHEMA_VERSION, promptVersion: RECON_PROMPT_VERSION, provider: p.name, telemetry: p.telemetry?.(), result });
  if (result.status !== "NEEDS_HUMAN_REVIEW" && result.output)
    for (const s of result.output.suggestions) {
      const idx = refs.findIndex((r) => r.ref === s.ref);
      if (idx >= 0 && s.action) byKey.set(batch[idx].key, { action: s.action, confidence: s.confidence });
    }
  return { executionId, byKey };
}

