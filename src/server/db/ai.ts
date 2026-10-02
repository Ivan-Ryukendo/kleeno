import "server-only";
import { randomUUID } from "node:crypto";
import { auditEvent } from "@/core/audit";
import type { AiResult } from "@/core/ai";
import type { AiOperation } from "@/core/ai/inputs";
import { writeAudit } from "./audit";
import { db, must } from "./client";

/** One AIExecution per AI call (rule 5, S19); immutable. The input is never stored, only its reference. */
export async function recordExecution(
  who: { companyId: string; correlationId: string },
  e: { operation: AiOperation; inputRef: string; schemaVersion: string; promptVersion: string; provider: string; result: AiResult<unknown> },
) {
  const id = randomUUID();
  must(
    await db()
      .from("ai_executions")
      .insert({
        id,
        company_id: who.companyId,
        operation: e.operation,
        correlation_id: who.correlationId,
        input_ref: e.inputRef,
        schema_version: e.schemaVersion,
        prompt_version: e.promptVersion,
        provider: e.provider,
        model: e.result.model,
        output: e.result.output,
        validation: { problems: e.result.problems, flags: e.result.flags, repairs: e.result.repairs },
        retries: e.result.retries,
        status: e.result.status,
      })
      .select("id"),
    "ai execution insert",
  );
  await writeAudit(auditEvent({ companyId: who.companyId, event: `ai.${e.operation.toLowerCase()}`, entityType: "ai_execution", entityId: id, actor: e.provider, actorType: "ai", correlationId: who.correlationId, refs: { status: e.result.status, retries: e.result.retries } }));
  return id;
}
