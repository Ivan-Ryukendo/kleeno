import { describe, expect, it } from "vitest";
import { EvidenceRetriever, SyntheticEmbeddingProvider, SyntheticKnowledgeRepository, ExactRecordSchema, knowledgeHash, validateEvidenceProposal, knowledgeInput, evidenceSpec, evidenceAudit } from "@/core/knowledge";
import { canonicalHash } from "@/core/canonical";
import { runValidated } from "@/core/ai";
import { CORPUS, clause, identity, RETRIEVAL_CASES, scope, evaluateSynthetic, paidLeaveProposal, SYNTHETIC_DUPLICATE_RECORDS, SYNTHETIC_DUPLICATE_RULES, SYNTHETIC_DUPLICATE_TASK } from "../../fixtures/knowledge/synthetic";

const records = [{ id: "leave-3", companyId: "company-a", runId: "run-a", workerId: "W003", kind: "LEAVE" as const, date: "2026-10-02", hours: "8", leaveType: "PAID" as const, sourceHash: canonicalHash("synthetic-leave-3") }];
const rules = [{ ruleId: "PAID_LEAVE" as const, configId: "config-a", configVersion: 2, clauseIds: ["C002"], paidLeaveAllowed: true }];
const task = { ref: "e1", category: "UNEXPLAINED_MISSING_HOURS" as const, runId: "run-a", workerId: "W003", payType: "SALARIED" as const, missingHours: "8" };
const proposal = paidLeaveProposal;
const retrieve = (corpus = CORPUS, s = scope()) => new EvidenceRetriever(new SyntheticKnowledgeRepository(corpus), new SyntheticEmbeddingProvider()).retrieve({ scope: s, exactIds: ["C002"], query: "paid leave", k: 3, task, records, rules });

describe("synthetic evidence retrieval boundaries", () => {
  it("prioritizes exact rules and filters tenant/version before ranking or limits", async () => {
    const repo = new SyntheticKnowledgeRepository(CORPUS);
    const eligible = await repo.loadCandidates(scope());
    expect(eligible.map(c => c.id)).toEqual(["C001", "C002", "C003", "C004", "C005", "C006", "C007"]);
    const p = await new EvidenceRetriever(repo, new SyntheticEmbeddingProvider()).retrieve({ scope: scope(), exactIds: ["OVERTIME"], query: "paid leave", k: 1 });
    expect(p.status).toBe("EVIDENCE_READY"); expect(p.knowledge.map(c => c.id)).toEqual(["C001"]);
    const historical = { ...scope(), configVersion: 1, sourceVersions: [{ sourceId: "policy-a", version: 1 }] };
    expect((await repo.loadCandidates(historical)).map(c => c.id)).toEqual(["OLD"]);
  });
  it("escalates a missing exact ID, conflict and partially covered period", async () => {
    const retriever = new EvidenceRetriever(new SyntheticKnowledgeRepository(CORPUS), new SyntheticEmbeddingProvider());
    expect((await retriever.retrieve({ scope: scope(), exactIds: ["FOREIGN"], query: "paid leave", k: 3 })).reasons).toContain("MISSING_EVIDENCE");
    const conflict = [...CORPUS, clause("CONFLICT", "PAID_LEAVE", "Salaried paid leave is not paid.")];
    expect((await retrieve(conflict)).reasons).toContain("CONFLICT");
    const partial = CORPUS.map(c => c.id === "C002" ? { ...c, effectiveFrom: "2026-10-15" } : c);
    expect((await retrieve(partial)).status).toBe("NEEDS_HUMAN_REVIEW");
  });
  it("validates vector identity, mappings, dimensions, finite values and provider failure", async () => {
    for (const kind of ["dimension", "mapping", "nan", "overflow", "model", "down"] as const) {
      const provider = { async embed() { if (kind === "down") throw Error("offline"); return { identity: kind === "model" ? { ...identity(), model: "other" } : identity(), items: [{ id: kind === "mapping" ? "other" : "query", values: Array.from({ length: kind === "dimension" ? 3 : 768 }, () => kind === "nan" ? NaN : kind === "overflow" ? 1e308 : 1) }] }; } };
      const p = await new EvidenceRetriever(new SyntheticKnowledgeRepository(CORPUS), provider).retrieve({ scope: scope(), exactIds: ["C002"], query: "paid leave", k: 3 });
      expect(p.status).toBe("NEEDS_HUMAN_REVIEW");
    }
  });
  it("binds immutable package hash and supplied citation subset to exact records/pinned rules", async () => {
    const p = await retrieve(); expect(p.hash).toBe(knowledgeHash(p));
    expect(validateEvidenceProposal(proposal(p), p, p).problems).toEqual([]);
    for (const changed of [ { ...proposal(p), packageHash: canonicalHash("wrong") }, { ...proposal(p), recordCitations: [{ id: "leave-3", sourceHash: canonicalHash("wrong") }] }, { ...proposal(p), citations: [{ ...proposal(p).citations[0], documentVersion: 1 }] }, { ...proposal(p), citations: [{ ...proposal(p).citations[0], id: "FOREIGN" }] } ]) expect(validateEvidenceProposal(changed, p, p).problems.length).toBeGreaterThan(0);
    const wrongWorker = { ...p, records: [{ ...records[0], workerId: "W999" }] };
    expect(validateEvidenceProposal(proposal(p), p, wrongWorker).problems.length).toBeGreaterThan(0);
    const revoked = { ...p, knowledge: p.knowledge.map(k => ({ ...k, approval: "REVOKED" as const })) };
    expect(validateEvidenceProposal(proposal(p), p, revoked).problems.length).toBeGreaterThan(0);
  });
  it("rejects unsupported claims and never interprets citation presence as approval", async () => {
    const p = await retrieve();
    const changed = { ...p, records: [{ ...records[0], leaveType: "UNPAID" as const }] };
    expect(validateEvidenceProposal(proposal(p), changed, changed).problems.length).toBeGreaterThan(0);
    const ai = { name: "synthetic", async complete() { return { model: "fake", text: JSON.stringify({ ...proposal(p), claims: [{ ...proposal(p).claims[0], kind: "ARBITRARY_PROSE_CLAIM" }] }) }; } };
    expect((await runValidated(ai, evidenceSpec(p, p), knowledgeInput(p))).status).toBe("NEEDS_HUMAN_REVIEW");
    const accepted = await runValidated({ name: "synthetic", async complete() { return { model: "fake", text: JSON.stringify(proposal(p)) }; } }, evidenceSpec(p,p), knowledgeInput(p));
    expect(accepted.status).toBe("ACCEPTED"); expect(accepted.flags).toContain("HUMAN_DECISION_REQUIRED");
  });
  it("requires typed approved-extra-hours and rejects duplicates with different overtime evidence", async () => {
    expect(ExactRecordSchema.safeParse({ ...SYNTHETIC_DUPLICATE_RECORDS[0], approvedExtraHours: undefined }).success).toBe(false);
    expect(ExactRecordSchema.safeParse({ ...records[0], approvedExtraHours: "0" }).success).toBe(false);
    const p = await new EvidenceRetriever(new SyntheticKnowledgeRepository(CORPUS), new SyntheticEmbeddingProvider()).retrieve({ scope: scope(), exactIds: ["HOURLY_RATE"], query: "identical duplicate timesheet records", k: 3, task: SYNTHETIC_DUPLICATE_TASK, records: SYNTHETIC_DUPLICATE_RECORDS, rules: SYNTHETIC_DUPLICATE_RULES });
    const evidence = p.knowledge.find(e => e.id === "C005")!;
    const duplicateProposal = { packageId: p.id, packageHash: p.hash, ref: "e2", action: "KEEP_FIRST" as const, citations: [{ id: evidence.id, sourceId: evidence.sourceId, clauseId: evidence.clauseId, configId: evidence.configId, documentVersion: evidence.documentVersion, configVersion: evidence.configVersion, sourceHash: evidence.sourceHash, contentHash: evidence.contentHash }], recordCitations: SYNTHETIC_DUPLICATE_RECORDS.map(r => ({ id: r.id, sourceHash: r.sourceHash })), claims: [{ kind: "IDENTICAL_TIMESHEET_DUPLICATES" as const, ruleId: "HOURLY_RATE" as const, knowledgeIds: ["C005"], recordIds: SYNTHETIC_DUPLICATE_RECORDS.map(r => r.id) }] };
    expect(validateEvidenceProposal(duplicateProposal, p, p).problems).toContain("UNSUPPORTED_DUPLICATE_CLAIM");
  });
  it("strictly excludes private notes/amounts/recipients and accepts finalized precedent only", async () => {
    const p = await retrieve();
    expect(() => knowledgeInput({ ...p, notes: "private worker name" })).toThrow();
    expect(() => knowledgeInput({ ...p, amount: "100", recipient: "wallet" })).toThrow();
    expect(() => new SyntheticKnowledgeRepository([{ ...CORPUS[0], employeeName: "Name" }])).toThrow();
    const audit = JSON.stringify(evidenceAudit(p,proposal(p)));
    expect(audit).not.toContain(CORPUS[1].text); expect(audit).not.toContain('"query"'); expect(audit).not.toContain('"hours"');
    const precedent = { id: "case-1", companyId: "company-a", configId: "config-a", configVersion: 2, category: task.category, action: "TREAT_AS_PAID_LEAVE" as const, finalized: true, humanApproved: true, outcome: "VERIFIED" as const, resolverId: "actor-a", resolvedAt: "2026-10-04T12:00:00Z", evidenceIds: ["C002", "leave-3"] };
    const retriever = new EvidenceRetriever(new SyntheticKnowledgeRepository(CORPUS), new SyntheticEmbeddingProvider());
    for (const item of [precedent, { ...precedent, finalized: false }, { ...precedent, humanApproved: false }, { ...precedent, outcome: "FAILED" as const }]) {
      const result = await retriever.retrieve({ scope: scope(), exactIds: ["C002"], query: "paid leave", k: 3, task, records, rules, precedents: [item] });
      expect(result.precedents).toHaveLength(item.finalized && item.humanApproved && item.outcome === "VERIFIED" ? 1 : 0);
    }
  });
  it("requires authoritative synthetic approval references and immutable complete generations", async () => {
    const chunks = CORPUS.slice(0,3);
    const untrusted = new SyntheticKnowledgeRepository([]);
    await expect(untrusted.ingestApproved({ sourceId: "policy-a", approvalRef: "human-approval-a", chunks })).rejects.toThrow(/approval/);
    const repo = new SyntheticKnowledgeRepository([], ["human-approval-a"]);
    expect(await repo.ingestApproved({ sourceId: "policy-a", approvalRef: "human-approval-a", chunks })).toEqual({ sourceId: "policy-a", generation: "synthetic-1" });
    await repo.ingestApproved({ sourceId: "policy-a", approvalRef: "human-approval-a", chunks });
    expect(await repo.loadCandidates(scope())).toHaveLength(3);
    await expect(repo.ingestApproved({ sourceId: "policy-a", approvalRef: "human-approval-a", chunks: chunks.slice(0,1) })).rejects.toThrow(/immutable/);
    await expect(repo.ingestApproved({ sourceId: "policy-a", approvalRef: "human-approval-a", chunks: [{ ...chunks[0], contentHash: canonicalHash("wrong") }] })).rejects.toThrow(/incomplete/);
  });
  it("measures frozen scenario recall and safety independently for 768 and 1536", async () => {
    const reports = await evaluateSynthetic(CORPUS, RETRIEVAL_CASES);
    expect(reports.map(r => r.dimension)).toEqual([768, 1536]);
    for (const r of reports) { expect(r.scenarios).toBe(11); expect(r.failedScenarios).toEqual([]); expect(r.tenantFailures).toBe(0); expect(r.disallowedVersionOverrides).toBe(0); expect(r.unsupportedAcceptedClaims).toBe(0); expect(r.escalationRate).toBe(1); expect(r.missingConflictScenarios).toBe(3); expect(r.missingConflictEscalationRate).toBe(1); expect(r.recallAtK).toBe(1); expect(r.exactIdScenarios).toBeGreaterThan(0); expect(r.exactIdPrecedenceRate).toBe(1); expect(r.latencyMs.p95).toBeGreaterThanOrEqual(0); }
  });
});
