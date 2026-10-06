import { canonicalHash } from "../canonical";
import { eligible, knowledgeHash } from "./retrieval";
import { validateEvidenceProposal } from "./evidence";
import type { EvidencePackage, KnowledgeEvidence, RetrievalInput, Retriever } from "./contracts";

export interface EvaluationScenario {
  id: string;
  input: RetrievalInput;
  expectedIds: readonly string[];
  expectedStatus: EvidencePackage["status"];
  requiredMissingConflict?: boolean;
  expectedPrecedents?: number;
  /** A fixed output to verify independently of ranking. Never calls a generative provider. */
  proposal?: (p: EvidencePackage) => unknown;
  expectedAccepted?: boolean;
}
export interface EvaluationResult {
  dimension: 768 | 1536;
  fixtureHash: string;
  scenarios: number;
  recallAtK: number;
  exactIdScenarios: number;
  exactIdPrecedenceRate: number;
  escalationRate: number;
  missingConflictScenarios: number;
  missingConflictEscalationRate: number;
  tenantFailures: number;
  disallowedVersionOverrides: number;
  unsupportedAcceptedClaims: number;
  failedScenarios: string[];
  latencyMs: { median: number; p95: number };
  results: { id: string; returnedIds: string[]; status: EvidencePackage["status"]; reasons: string[]; accepted: boolean | null; latencyMs: number }[];
}

/** Measured native synthetic evaluation. The caller freezes fixtures/configuration before invoking either dimension. */
export async function evaluateRetrieval(dimension: 768 | 1536, scenarios: readonly EvaluationScenario[], factory: (scenario: EvaluationScenario) => Retriever, corpus: readonly KnowledgeEvidence[]): Promise<EvaluationResult> {
  if (!scenarios.length || new Set(scenarios.map(s => s.id)).size !== scenarios.length || corpus.some(c => c.classification !== "SYNTHETIC") || scenarios.some(s => s.input.scope.embedding.dimension !== dimension)) throw Error("invalid fixed evaluation");
  let expected = 0, found = 0, exactIdScenarios = 0, exactIdPrecedenceHits = 0, needsEscalation = 0, escalated = 0, missingConflictScenarios = 0, missingConflictEscalations = 0, tenantFailures = 0, disallowedVersionOverrides = 0, unsupportedAcceptedClaims = 0;
  const failedScenarios: string[] = [];
  const results: EvaluationResult["results"] = [];
  const proposals: unknown[] = [];
  for (const s of scenarios) {
    const started = performance.now();
    const p = await factory(s).retrieve(s.input);
    const latencyMs = performance.now() - started;
    const returnedIds = p.knowledge.map(e => e.id);
    const exactReturned = p.knowledge.filter(e => s.input.exactIds.some(id => e.id === id || e.clauseId === id || e.ruleId === id));
    if (exactReturned.length) {
      exactIdScenarios++;
      if (exactReturned.every((e,index) => returnedIds[index] === e.id)) exactIdPrecedenceHits++;
    }
    expected += s.expectedIds.length;
    found += s.expectedIds.filter(id => returnedIds.includes(id)).length;
    tenantFailures += p.knowledge.filter(e => e.companyId !== s.input.scope.companyId).length + p.records.filter(r => r.companyId !== s.input.scope.companyId).length;
    disallowedVersionOverrides += p.knowledge.filter(e => !eligible(e,s.input.scope)).length;
    if (s.expectedStatus === "NEEDS_HUMAN_REVIEW") { needsEscalation++; if (p.status === s.expectedStatus) escalated++; }
    if (s.requiredMissingConflict) { missingConflictScenarios++; if (p.status === "NEEDS_HUMAN_REVIEW") missingConflictEscalations++; }
    const proposal = s.proposal?.(p);
    proposals.push(proposal ?? null);
    const accepted = proposal ? validateEvidenceProposal(proposal,p,p).problems.length === 0 : null;
    if (s.expectedAccepted === false && accepted) unsupportedAcceptedClaims++;
    if (p.hash !== knowledgeHash(p) || p.status !== s.expectedStatus || s.expectedIds.some(id => !returnedIds.includes(id)) || (s.expectedAccepted !== undefined && accepted !== s.expectedAccepted) || (s.expectedPrecedents !== undefined && p.precedents.length !== s.expectedPrecedents)) failedScenarios.push(s.id);
    results.push({ id: s.id, returnedIds, status: p.status, reasons: p.reasons, accepted, latencyMs });
  }
  const timings = results.map(r => r.latencyMs).sort((a,b) => a-b);
  // Query/policy strings exist only in the synthetic fixture hash input; the published result contains no raw text.
  const fixtureHash = canonicalHash({ corpus, scenarios: scenarios.map((s,index) => ({ id: s.id, input: s.input, expectedIds: s.expectedIds, expectedStatus: s.expectedStatus, requiredMissingConflict: s.requiredMissingConflict ?? false, expectedPrecedents: s.expectedPrecedents ?? null, expectedAccepted: s.expectedAccepted ?? null, proposal: proposals[index] })) });
  return { dimension, fixtureHash, scenarios: scenarios.length, recallAtK: expected ? found / expected : 0, exactIdScenarios, exactIdPrecedenceRate: exactIdScenarios ? exactIdPrecedenceHits / exactIdScenarios : 1, escalationRate: needsEscalation ? escalated / needsEscalation : 0, missingConflictScenarios, missingConflictEscalationRate: missingConflictScenarios ? missingConflictEscalations / missingConflictScenarios : 0, tenantFailures, disallowedVersionOverrides, unsupportedAcceptedClaims, failedScenarios, latencyMs: { median: timings[Math.floor(timings.length / 2)], p95: timings[Math.ceil(timings.length * 0.95) - 1] }, results };
}
