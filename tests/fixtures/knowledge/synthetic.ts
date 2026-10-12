import { canonicalHash } from "@/core/canonical";
import type { RuleId } from "@/core/config";
import { EvidenceRetriever, SyntheticEmbeddingProvider, SyntheticKnowledgeRepository, evaluateRetrieval, type EvaluationScenario, type EvidencePackage } from "@/core/knowledge";

// Fixed synthetic corpus. These clauses describe no real employer or worker.
export const identity = (dimension: 768 | 1536 = 768) => ({ provider: "synthetic-local", model: "token-hash-v1", modelVersion: "1", dimension, preparationVersion: "synthetic-v1" });
export const scope = (dimension: 768 | 1536 = 768) => ({ companyId: "company-a", configId: "config-a", configVersion: 2, sourceVersions: [{ sourceId: "policy-a", version: 2 }], corpusGeneration: "synthetic-1", embedding: identity(dimension), period: { start: "2026-10-01", end: "2026-10-31" } });
export function clause(id: string, ruleId: RuleId, text: string, overrides = {}) {
  return { id, sourceId: "policy-a", clauseId: id, companyId: "company-a", configId: "config-a", configVersion: 2, documentVersion: 2, sourceHash: canonicalHash("synthetic-policy-a-v2"), contentHash: canonicalHash(text), approvalRef: "human-approval-a", approval: "APPROVED" as const, effectiveFrom: "2026-01-01", effectiveTo: null, corpusGeneration: "synthetic-1", embedding: identity(), classification: "SYNTHETIC" as const, ruleId, text, ...overrides };
}
export const CORPUS = [
  clause("C001", "OVERTIME", "Overtime hours require approved extra hours in the timesheet record."),
  clause("C002", "PAID_LEAVE", "Paid leave remains paid for salaried workers when an approved paid leave record covers missing hours."),
  clause("C003", "UNPAID_LEAVE", "Unpaid leave remains unpaid. A paid leave record must never be treated as unpaid absence."),
  clause("C004", "BASE_SALARY", "Base salary uses the approved salaried employment period."),
  clause("C005", "HOURLY_RATE", "Hourly workers use recorded actual work hours. Identical duplicated timesheet records may keep the first record."),
  clause("C006", "FIXED_RETAINER", "Contractor retainers are fixed for the contractual period."),
  clause("C007", "PERCENT_DEDUCTION", "Percentage deductions use the approved company configuration."),
  clause("OLD", "PAID_LEAVE", "Historical paid leave clause.", { documentVersion: 1, configVersion: 1, approval: "SUPERSEDED" }),
  clause("FOREIGN", "PAID_LEAVE", "Paid leave for another company.", { companyId: "company-b", sourceId: "policy-b", configId: "config-b" }),
];
export const RETRIEVAL_CASES = [
  { id: "exact-overtime", query: "extra hours", exactIds: ["OVERTIME"], expected: "C001" },
  { id: "paid-versus-unpaid", query: "paid leave covers missing hours", exactIds: ["PAID_LEAVE"], expected: "C002" },
  { id: "pinned-current", query: "paid leave", exactIds: ["C002"], expected: "C002" },
  { id: "tenant-isolation", query: "another company leave", exactIds: ["PAID_LEAVE"], expected: "C002" },
  { id: "paraphrase", query: "compensated absence for salary staff", exactIds: [], expected: "C002" },
  { id: "missing-rule", query: "missing clause", exactIds: ["ABSENT"], expected: null },
  { id: "conflicting-sources", query: "paid leave", exactIds: ["PAID_LEAVE"], expected: null },
  { id: "partial-effective-period", query: "paid leave", exactIds: ["PAID_LEAVE"], expected: null },
  { id: "wrong-provenance", query: "paid leave", exactIds: ["C002"], expected: "C002" },
  { id: "unsupported-claim", query: "paid leave", exactIds: ["C002"], expected: "C002" },
  { id: "approved-precedent", query: "paid leave", exactIds: ["C002"], expected: "C002" },
] as const;

export const SYNTHETIC_RECORDS = [{ id: "leave-3", companyId: "company-a", runId: "run-a", workerId: "W003", kind: "LEAVE" as const, date: "2026-10-02", hours: "8", leaveType: "PAID" as const, sourceHash: canonicalHash("synthetic-leave-3") }];
export const SYNTHETIC_RULES = [{ ruleId: "PAID_LEAVE" as const, configId: "config-a", configVersion: 2, clauseIds: ["C002"], paidLeaveAllowed: true }];
export const SYNTHETIC_TASK = { ref: "e1", category: "UNEXPLAINED_MISSING_HOURS" as const, runId: "run-a", workerId: "W003", payType: "SALARIED" as const, missingHours: "8" };
export const SYNTHETIC_DUPLICATE_RECORDS = [
  { id: "timesheet-1", companyId: "company-a", runId: "run-a", workerId: "W005", kind: "TIMESHEET" as const, date: "2026-10-02", hours: "4", approvedExtraHours: "0", sourceHash: canonicalHash("synthetic-timesheet-1") },
  { id: "timesheet-2", companyId: "company-a", runId: "run-a", workerId: "W005", kind: "TIMESHEET" as const, date: "2026-10-02", hours: "4", approvedExtraHours: "2", sourceHash: canonicalHash("synthetic-timesheet-2") },
];
export const SYNTHETIC_DUPLICATE_RULES = [{ ruleId: "HOURLY_RATE" as const, configId: "config-a", configVersion: 2, clauseIds: ["C005"] }];
export const SYNTHETIC_DUPLICATE_TASK = { ref: "e2", category: "DUPLICATE_TIMESHEET" as const, runId: "run-a", workerId: "W005", payType: "HOURLY" as const };
export const paidLeaveProposal = (p: Pick<EvidencePackage,"id" | "hash">) => ({ packageId: p.id, packageHash: p.hash, ref: "e1", action: "TREAT_AS_PAID_LEAVE" as const, citations: [{ id: "C002", sourceId: "policy-a", clauseId: "C002", configId: "config-a", documentVersion: 2, configVersion: 2, sourceHash: CORPUS[1].sourceHash, contentHash: CORPUS[1].contentHash }], recordCitations: [{ id: "leave-3", sourceHash: SYNTHETIC_RECORDS[0].sourceHash }], claims: [{ kind: "PAID_LEAVE_COVERS_MISSING_HOURS" as const, ruleId: "PAID_LEAVE" as const, knowledgeIds: ["C002"], recordIds: ["leave-3"] }] });

export async function evaluateSynthetic(corpus = CORPUS, cases = RETRIEVAL_CASES) {
  const reports = [];
  for (const dimension of [768,1536] as const) {
    const scenarios: EvaluationScenario[] = cases.map(c => ({
      id: c.id, input: { scope: scope(dimension), query: c.query, exactIds: c.exactIds, k: 3, task: SYNTHETIC_TASK, records: c.id === "wrong-provenance" ? [{ ...SYNTHETIC_RECORDS[0], workerId: "W999" }] : c.id === "unsupported-claim" ? [{ ...SYNTHETIC_RECORDS[0], leaveType: "UNPAID" }] : SYNTHETIC_RECORDS, rules: SYNTHETIC_RULES,
        precedents: c.id === "approved-precedent" ? [{ id: "precedent-a", companyId: "company-a", configId: "config-a", configVersion: 2, category: SYNTHETIC_TASK.category, action: "TREAT_AS_PAID_LEAVE", finalized: true, humanApproved: true, outcome: "VERIFIED", resolverId: "actor-a", resolvedAt: "2026-10-04T12:00:00Z", evidenceIds: ["C002","leave-3"] }] : [],
      },
      expectedIds: c.expected === null || c.id === "wrong-provenance" ? [] : [c.expected],
      expectedStatus: c.expected === null || c.id === "wrong-provenance" ? "NEEDS_HUMAN_REVIEW" : "EVIDENCE_READY",
      requiredMissingConflict: ["missing-rule", "conflicting-sources", "partial-effective-period"].includes(c.id),
      ...(c.id === "unsupported-claim" || c.id === "wrong-provenance" ? { proposal: paidLeaveProposal, expectedAccepted: false } : c.id === "approved-precedent" ? { proposal: paidLeaveProposal, expectedAccepted: true, expectedPrecedents: 1 } : {}),
    }));
    const bind = (items: typeof corpus) => items.map(e => ({ ...e, embedding: identity(dimension) }));
    reports.push(await evaluateRetrieval(dimension,scenarios,s => {
      let local = corpus;
      if (s.id === "conflicting-sources") local = [...corpus,clause("CONFLICT","PAID_LEAVE","Salaried paid leave is not paid.")];
      if (s.id === "partial-effective-period") local = corpus.map(e => e.id === "C002" ? { ...e, effectiveFrom: "2026-10-15" } : e);
      return new EvidenceRetriever(new SyntheticKnowledgeRepository(bind(local)),new SyntheticEmbeddingProvider());
    },bind(corpus)));
  }
  return reports;
}
