import { z } from "zod";
import { CalendarDateSchema } from "../workers";
import { RULE_IDS } from "../config";
import { OPTIONS, RECON_CATEGORIES, type ReconCategory, type ResolutionAction } from "../reconciliation";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const hours = z.string().regex(/^\d{1,7}(?:\.\d{1,2})?$/);
export const EmbeddingIdentitySchema = z.object({ provider: id, model: id, modelVersion: id.nullable(), dimension: z.union([z.literal(768), z.literal(1536)]), preparationVersion: id }).strict();
export type EmbeddingIdentity = z.infer<typeof EmbeddingIdentitySchema>;
export const RetrievalScopeSchema = z.object({ companyId: id, configId: id, configVersion: z.number().int().positive(), sourceVersions: z.array(z.object({ sourceId: id, version: z.number().int().positive() }).strict()).min(1).max(100), corpusGeneration: id, embedding: EmbeddingIdentitySchema, period: z.object({ start: CalendarDateSchema, end: CalendarDateSchema }).strict().refine(p => p.start <= p.end, "invalid period") }).strict().refine(s => new Set(s.sourceVersions.map(v => v.sourceId)).size === s.sourceVersions.length, "duplicate source version");
export type RetrievalScope = z.infer<typeof RetrievalScopeSchema>;
export const KnowledgeEvidenceSchema = z.object({ id, sourceId: id, clauseId: id, companyId: id, configId: id, configVersion: z.number().int().positive(), documentVersion: z.number().int().positive(), sourceHash: hash, contentHash: hash, approvalRef: id, approval: z.enum(["APPROVED", "SUPERSEDED", "REVOKED", "DRAFT"]), effectiveFrom: CalendarDateSchema, effectiveTo: CalendarDateSchema.nullable(), corpusGeneration: id, embedding: EmbeddingIdentitySchema, classification: z.literal("SYNTHETIC"), ruleId: z.enum(RULE_IDS), text: z.string().min(1).max(2000) }).strict().refine(e => e.effectiveTo === null || e.effectiveFrom <= e.effectiveTo, "invalid effective interval");
export type KnowledgeEvidence = z.infer<typeof KnowledgeEvidenceSchema>;
export const ExactRecordSchema = z.discriminatedUnion("kind", [
  z.object({ id, companyId: id, runId: id, workerId: id, kind: z.literal("LEAVE"), date: CalendarDateSchema, hours, leaveType: z.enum(["PAID", "UNPAID"]), sourceHash: hash }).strict(),
  z.object({ id, companyId: id, runId: id, workerId: id, kind: z.literal("TIMESHEET"), date: CalendarDateSchema, hours, approvedExtraHours: hours, sourceHash: hash }).strict(),
]);
export type ExactRecord = z.infer<typeof ExactRecordSchema>;
export const PinnedRuleSchema = z.object({ ruleId: z.enum(RULE_IDS), configId: id, configVersion: z.number().int().positive(), clauseIds: z.array(id).min(1).max(500), paidLeaveAllowed: z.boolean().optional() }).strict();
export type PinnedRule = z.infer<typeof PinnedRuleSchema>;
export const EvidenceTaskSchema = z.object({ ref: z.string().regex(/^e\d{1,3}$/), category: z.enum(RECON_CATEGORIES as [ReconCategory, ...ReconCategory[]]), runId: id, workerId: id, payType: z.enum(["SALARIED", "HOURLY", "RETAINER"]), missingHours: hours.optional() }).strict();
export type EvidenceTask = z.infer<typeof EvidenceTaskSchema>;
const actions = [...new Set(Object.values(OPTIONS).flat())] as [ResolutionAction, ...ResolutionAction[]];
export const PrecedentSchema = z.object({ id, companyId: id, configId: id, configVersion: z.number().int().positive(), category: z.enum(RECON_CATEGORIES as [ReconCategory, ...ReconCategory[]]), action: z.enum(actions), finalized: z.boolean(), humanApproved: z.boolean(), outcome: z.enum(["VERIFIED", "FAILED", "UNVERIFIED"]), resolverId: id, resolvedAt: z.iso.datetime(), evidenceIds: z.array(id).min(1).max(40) }).strict();
export type Precedent = z.infer<typeof PrecedentSchema>;
export const REASONS = ["MISSING_EVIDENCE", "WRONG_SCOPE", "DISALLOWED_VERSION", "NOT_EFFECTIVE", "CONFLICT", "INCOMPLETE", "PROVIDER_UNAVAILABLE", "INVALID_EMBEDDING", "INVALID_INPUT"] as const;
export type RetrievalReason = typeof REASONS[number];
export const EvidencePackageSchema = z.object({ id: hash, hash, scope: RetrievalScopeSchema, task: EvidenceTaskSchema.optional(), knowledge: z.array(KnowledgeEvidenceSchema).max(20), records: z.array(ExactRecordSchema).max(40), rules: z.array(PinnedRuleSchema).max(100), precedents: z.array(PrecedentSchema).max(10), status: z.enum(["EVIDENCE_READY", "NEEDS_HUMAN_REVIEW"]), reasons: z.array(z.enum(REASONS)).max(10), retrievalVersion: z.literal("native-synthetic-v1"), queryHash: hash, exactIds: z.array(id).max(20) }).strict();
export type EvidencePackage = z.infer<typeof EvidencePackageSchema>;
export interface EmbeddingProvider {
  embed(input: { items: { id: string; safeText: string }[]; purpose: "QUERY" | "DOCUMENT"; dimension: 768 | 1536 }): Promise<{ identity: EmbeddingIdentity; items: { id: string; values: readonly number[] }[] }>;
}
// No production ingestion adapter is enabled before the storage/privacy gate.
export interface ApprovedIngestion { sourceId: string; approvalRef: string; chunks: KnowledgeEvidence[] }
export interface KnowledgeRepository {
  loadByIds(scope: RetrievalScope, ids: readonly string[]): Promise<KnowledgeEvidence[]>;
  loadCandidates(scope: RetrievalScope): Promise<KnowledgeEvidence[]>;
  ingestApproved(input: ApprovedIngestion): Promise<{ sourceId: string; generation: string }>;
}
export interface RetrievalInput { scope: RetrievalScope; exactIds: readonly string[]; query: string; k: number; task?: EvidenceTask; records?: ExactRecord[]; rules?: PinnedRule[]; precedents?: Precedent[] }
export interface Retriever { retrieve(input: RetrievalInput): Promise<EvidencePackage> }
