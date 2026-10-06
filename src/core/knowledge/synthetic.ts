import { z } from "zod";
import { canonicalHash, canonicalString } from "../canonical";
import { eligible } from "./retrieval";
import { KnowledgeEvidenceSchema, RetrievalScopeSchema, type ApprovedIngestion, type EmbeddingIdentity, type EmbeddingProvider, type KnowledgeEvidence, type KnowledgeRepository, type RetrievalScope } from "./contracts";

const identity = (dimension: 768 | 1536): EmbeddingIdentity => ({ provider: "synthetic-local", model: "token-hash-v1", modelVersion: "1", dimension, preparationVersion: "synthetic-v1" });
const terms = (s: string) => s.toLowerCase().replace(/compensated|compensation/g,"paid").replace(/absence/g,"leave").replace(/salary|staff/g,"salaried").replace(/extra hours/g,"overtime").match(/[a-z0-9]+/g) ?? [];
/** Test/evaluation provider only. Token hashing is deterministic, not a measurement of any external embedding model. */
export class SyntheticEmbeddingProvider implements EmbeddingProvider {
  async embed(input: Parameters<EmbeddingProvider["embed"]>[0]) {
    z.object({ items: z.array(z.object({ id: z.string().min(1).max(80), safeText: z.string().min(1).max(2000) }).strict()).min(1).max(501), purpose: z.enum(["QUERY", "DOCUMENT"]), dimension: z.union([z.literal(768),z.literal(1536)]) }).strict().parse(input);
    return { identity: identity(input.dimension), items: input.items.map(item => {
      const values = Array<number>(input.dimension).fill(0);
      for (const token of terms(item.safeText)) { const digest = canonicalHash(token); values[parseInt(digest.slice(0,8),16) % input.dimension] += 1; }
      return { id: item.id, values };
    }) };
  }
}
/** In-memory synthetic adapter. No real data, DB storage, SQL vector claims or provider calls. */
export class SyntheticKnowledgeRepository implements KnowledgeRepository {
  private corpus: KnowledgeEvidence[];
  private readonly approvals: ReadonlySet<string>;
  constructor(corpus: unknown, approvedIngestionReferences: readonly string[] = []) {
    this.corpus = z.array(KnowledgeEvidenceSchema).max(500).parse(corpus);
    if (this.corpus.some(c => canonicalHash(c.text) !== c.contentHash) || new Set(this.corpus.map(c => `${c.companyId}:${c.id}`)).size !== this.corpus.length) throw Error("invalid synthetic corpus");
    this.approvals = new Set(approvedIngestionReferences);
  }
  async loadCandidates(input: RetrievalScope) {
    const scope = RetrievalScopeSchema.parse(input);
    // Eligibility is applied to every candidate before any ranking/limit, including this service-role analogue.
    return structuredClone(this.corpus.filter(e => eligible(e,scope)));
  }
  async loadByIds(scope: RetrievalScope, ids: readonly string[]) { return (await this.loadCandidates(scope)).filter(e => ids.some(id => e.id === id || e.clauseId === id || e.ruleId === id)); }
  async ingestApproved(input: ApprovedIngestion) {
    z.object({ sourceId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), approvalRef: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), chunks: z.array(KnowledgeEvidenceSchema).min(1).max(500) }).strict().parse(input);
    if (!this.approvals.has(input.approvalRef)) throw Error("approval not authoritative");
    const chunks = z.array(KnowledgeEvidenceSchema).min(1).max(500).parse(input.chunks);
    const first = chunks[0];
    if (chunks.some(c => c.sourceId !== input.sourceId || c.approvalRef !== input.approvalRef || c.approval !== "APPROVED" || c.companyId !== first.companyId || c.documentVersion !== first.documentVersion || c.configId !== first.configId || c.configVersion !== first.configVersion || c.effectiveFrom !== first.effectiveFrom || c.effectiveTo !== first.effectiveTo || canonicalString(c.embedding) !== canonicalString(first.embedding) || c.sourceHash !== first.sourceHash || c.corpusGeneration !== first.corpusGeneration || canonicalHash(c.text) !== c.contentHash) || new Set(chunks.map(c => c.id)).size !== chunks.length) throw Error("incomplete source generation");
    const existing = this.corpus.filter(c => c.companyId === first.companyId && c.sourceId === input.sourceId && c.documentVersion === first.documentVersion && c.corpusGeneration === first.corpusGeneration);
    if (existing.length && canonicalHash(existing) !== canonicalHash(chunks)) throw Error("immutable source generation");
    if (!existing.length) {
      if (this.corpus.length + chunks.length > 500 || chunks.some(c => this.corpus.some(old => old.companyId === c.companyId && old.id === c.id))) throw Error("duplicate or oversized corpus");
      this.corpus = [...this.corpus,...structuredClone(chunks)];
    }
    return { sourceId: input.sourceId, generation: first.corpusGeneration };
  }
}
