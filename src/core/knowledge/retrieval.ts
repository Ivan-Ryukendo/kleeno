import { z } from "zod";
import { canonicalHash, canonicalString } from "../canonical";
import { EvidencePackageSchema, EvidenceTaskSchema, ExactRecordSchema, PinnedRuleSchema, PrecedentSchema, RetrievalScopeSchema, KnowledgeEvidenceSchema, EmbeddingIdentitySchema, type EmbeddingProvider, type EvidencePackage, type KnowledgeEvidence, type KnowledgeRepository, type RetrievalInput, type RetrievalReason, type RetrievalScope } from "./contracts";
import { OPTIONS } from "../reconciliation";

export const knowledgeHash = (p: EvidencePackage): string => {
  const { id: _id, hash: _hash, ...body } = p;
  void _id; void _hash;
  return canonicalHash(body);
};
export const eligible = (e: KnowledgeEvidence, s: RetrievalScope): boolean => e.companyId === s.companyId && e.configId === s.configId && e.configVersion === s.configVersion && s.sourceVersions.some(v => v.sourceId === e.sourceId && v.version === e.documentVersion) && ["APPROVED", "SUPERSEDED"].includes(e.approval) && e.effectiveFrom <= s.period.start && (e.effectiveTo === null || e.effectiveTo >= s.period.end) && e.corpusGeneration === s.corpusGeneration && canonicalString(e.embedding) === canonicalString(s.embedding);
const matches = (e: KnowledgeEvidence, id: string) => e.id === id || e.clauseId === id || e.ruleId === id;
const tokenize = (s: string) => [...new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? [])];
const lexical = (query: string, text: string) => { const terms = tokenize(text); return tokenize(query).filter(t => terms.includes(t)).length; };
const cosine = (a: readonly number[], b: readonly number[]) => {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  if (!aa || !bb) throw Error("zero embedding");
  return dot / Math.sqrt(aa * bb);
};

/** Native bounded ranking. Repository must filter candidates before ranking/limits; this re-check is defense in depth. */
export class EvidenceRetriever {
  constructor(private readonly repository: KnowledgeRepository, private readonly embeddings: EmbeddingProvider) {}
  async retrieve(input: RetrievalInput): Promise<EvidencePackage> {
    const scope = RetrievalScopeSchema.parse(input.scope);
    const exactIds = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)).max(20).parse(input.exactIds);
    const query = z.string().min(1).max(500).parse(input.query);
    const k = z.number().int().min(1).max(20).parse(input.k);
    const task = input.task === undefined ? undefined : EvidenceTaskSchema.parse(input.task);
    const records = z.array(ExactRecordSchema).max(40).parse(input.records ?? []);
    const rules = z.array(PinnedRuleSchema).max(100).parse(input.rules ?? []);
    const precedents = z.array(PrecedentSchema).max(10).parse(input.precedents ?? []);
    const reasons: RetrievalReason[] = [];
    const fail = (reason: RetrievalReason) => { if (!reasons.includes(reason)) reasons.push(reason); };
    let knowledge: KnowledgeEvidence[] = [];
    if (new Set(exactIds).size !== exactIds.length || new Set(records.map(r => r.id)).size !== records.length || new Set(rules.map(r => r.ruleId)).size !== rules.length) fail("INVALID_INPUT");
    if (records.some(r => !task || r.companyId !== scope.companyId || r.runId !== task.runId || r.workerId !== task.workerId || r.date < scope.period.start || r.date > scope.period.end)) fail("WRONG_SCOPE");
    if (rules.some(r => r.configId !== scope.configId || r.configVersion !== scope.configVersion)) fail("DISALLOWED_VERSION");
    try {
      const loaded = z.array(KnowledgeEvidenceSchema).max(500).parse(await this.repository.loadCandidates(scope));
      if (loaded.some(e => !eligible(e, scope))) fail("WRONG_SCOPE");
      const candidates = loaded.filter(e => eligible(e, scope));
      if (new Set(candidates.map(e => e.id)).size !== candidates.length || candidates.some(e => canonicalHash(e.text) !== e.contentHash)) fail("INCOMPLETE");
      if (!candidates.length || exactIds.some(id => !candidates.some(e => matches(e,id)))) fail("MISSING_EVIDENCE");
      // ponytail: conservatively escalate different approved clauses for one rule; a reviewed scope-aware predicate can narrow this later.
      for (const e of candidates) if (candidates.some(other => other.ruleId === e.ruleId && other.contentHash !== e.contentHash)) fail("CONFLICT");
      const exact = candidates.filter(e => exactIds.some(id => matches(e,id))).sort((a,b) => a.id.localeCompare(b.id));
      if (exact.length > k) fail("INCOMPLETE");
      if (!reasons.length) {
        let responses: Awaited<ReturnType<EmbeddingProvider["embed"]>>[] | undefined;
        try { responses = await Promise.all([
          this.embeddings.embed({ items: [{ id: "query", safeText: query }], purpose: "QUERY", dimension: scope.embedding.dimension }),
          this.embeddings.embed({ items: candidates.map(e => ({ id: e.id, safeText: e.text })), purpose: "DOCUMENT", dimension: scope.embedding.dimension }),
        ]); }
        catch { fail("PROVIDER_UNAVAILABLE"); }
        if (responses) {
          const valid = responses.every((response,index) => {
            const expectedIds = index === 0 ? ["query"] : candidates.map(e => e.id);
            const identity = EmbeddingIdentitySchema.safeParse(response.identity);
            return identity.success && canonicalString(identity.data) === canonicalString(scope.embedding) && response.items.length === expectedIds.length && new Set(response.items.map(i => i.id)).size === expectedIds.length && expectedIds.every(id => response.items.some(i => i.id === id)) && response.items.every(i => i.values.length === scope.embedding.dimension && i.values.every(Number.isFinite) && i.values.some(v => v !== 0) && Number.isFinite(i.values.reduce((n,v) => n + v ** 2,0)));
          });
          if (!valid) fail("INVALID_EMBEDDING");
          else {
            const vectors = new Map(responses[1].items.map(i => [i.id, i.values]));
            const queryVector = responses[0].items[0].values;
            const rank = (score: (e: KnowledgeEvidence) => number) => [...candidates].sort((a,b) => score(b) - score(a) || a.id.localeCompare(b.id));
            const lexicalRank = rank(e => lexical(query,e.text)), semanticRank = rank(e => cosine(queryVector, vectors.get(e.id)!));
            if (!exact.length && candidates.every(e => lexical(query,e.text) === 0 && cosine(queryVector,vectors.get(e.id)!) <= 0)) fail("MISSING_EVIDENCE");
            const fusion = (e: KnowledgeEvidence) => 1 / (60 + lexicalRank.indexOf(e) + 1) + 1 / (60 + semanticRank.indexOf(e) + 1);
            if (!reasons.length) knowledge = [...exact, ...rank(fusion).filter(e => !exact.includes(e))].slice(0,k);
          }
        }
      }
    } catch { fail("INCOMPLETE"); }
    const trustedPrecedents = precedents.filter(p => !reasons.length && p.companyId === scope.companyId && p.configId === scope.configId && p.configVersion === scope.configVersion && p.finalized && p.humanApproved && p.outcome === "VERIFIED" && task?.category === p.category && OPTIONS[task.category].includes(p.action) && p.evidenceIds.every(id => knowledge.some(e => e.id === id) || records.some(r => r.id === id)));
    const body = { scope, ...(task ? { task } : {}), knowledge, records, rules, precedents: trustedPrecedents, status: reasons.length ? "NEEDS_HUMAN_REVIEW" as const : "EVIDENCE_READY" as const, reasons, retrievalVersion: "native-synthetic-v1" as const, queryHash: canonicalHash(query), exactIds };
    const hash = canonicalHash(body);
    return EvidencePackageSchema.parse({ ...body, id: hash, hash });
  }
}
