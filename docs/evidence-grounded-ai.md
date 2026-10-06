# Evidence-Grounded AI and Controlled Learning — plan

User direction recorded 2026-10-05. Status: **documentation approved for incorporation by this request; implementation proposed, not built**. Submission deadline: **October 17, 2026**. Scope/timeline authority: `PRD.md`; non-negotiable rules: `ARCHITECTURE-ESSENTIALS.md`. Conditional implementation phase: `docs/phases/P4r.md`.

## 1. Placement and files

This is product/architecture planning, not provisioning. `src/server/circle/provisioning.ts` provisions wallets and PayrollGuard after platform approval; retrieval has no reason to change it. No generic provision file or parallel logging system is needed.

| Document | Responsibility in this update |
|---|---|
| `PRD.md` | Verified Payroll Automation position, conditional MVP scope, acceptance, dependency-aware October 17 schedule and cuts |
| `ARCHITECTURE-ESSENTIALS.md` | Evidence, retrieval and controlled-learning boundaries; preserve all financial rules |
| `ARCHITECTURE.md` | Retrieval flow, eight control gates, three product memory types, extension of AIExecution/audit |
| `FILE-STRUCTURE.md` | Actual new planning/memory files and clearly labelled future code paths |
| `PROGRESS.md`, `README.md` | Honest current status: built, verified, parked and proposed |
| `AGENT.md`, `CLAUDE.md`, `docs/memory/project.md` | Entry point, durable decisions, restore/revocation protocol |
| `docs/roadmap.md`, `docs/phases/P4r.md` | MVP versus post-event work; conditional phase slices and acceptance checks |
| `docs/security.md`, `docs/github.md`, affected phase/ADR notes | Planned retrieval controls, privacy decision, freeze/deploy dates; preserve historical results |
| `docs/pages.md` | Evidence/provenance and structured Agent Activity Record on existing screens |

Do not present competitor feature lists as independently verified market research. AI Payroller/Beam AI comparisons supplied by the user motivate positioning; this session does not audit competitors or claim exclusive capabilities.

## 2. Position and evidence chain

**Kleeno — Verified Payroll Automation**

AI understands. Evidence grounds. Validation verifies. Humans govern. Deterministic code executes. Audit proves.

Supporting message: every consequential recommendation should expose its evidence and validation; every payment must remain traceable to its approved obligation. This is the intended capability, not a claim that the new retrieval system already exists.

Verification chain: POLICY → EVIDENCE → RULE → DATA → EXCEPTION → CALCULATION → CALCULATION HASH → APPROVAL → OBLIGATION → PAYMENT → SETTLEMENT.

Recommendation provenance: SOURCE → DOCUMENT → CLAUSE / RECORD → VERSION → EFFECTIVE DATE → RETRIEVED EVIDENCE → AI PROPOSAL → VALIDATION → HUMAN DECISION → DETERMINISTIC RESULT.

Each evidence reference is a stable tenant-scoped identity, not a filename, similarity score or model assertion. Bind policy identity to document/config version and clause ID; bind record identity to company/run/worker and the source hash/snapshot. Validate these joins server-side. Examples such as `POLICY-17` and `TIMESHEET-103` are display labels, not newly implemented schema identifiers.

## 3. Existing coverage and gaps

Repository inspection on 2026-10-05; code presence is not fresh cloud/browser verification.

| Work item | Current status / disposition |
|---|---|
| P3 data/AI, P3b companies | Merged per local git history; existing AI/provenance controls reused |
| P4 payments and P4u shell | Merged; P1 scripted Arc settlement is recorded in PROGRESS, not rerun here |
| Google sign-in P4g | Slice 1 code present on current branch, uncommitted; real provider round trip still unverified |
| Standing authorization | Parked until non-fallback P4b planner path; migration on dev is inert per latest PROGRESS |
| Gateway/x402 | Code and fake-backed tests exist; real live integrations unverified (S67/S68) |
| Policy documents/scopes/additions P4c; full dashboard P4d; AI payment planner P4b | Planned; their phase specifications are still to be written before implementation; current closeout checklist in `p4-p5-readiness.md` |
| Evidence-Grounded AI / hybrid retrieval / Gemini embedding comparison | New conditional P4r specification; no adapter, knowledge tables or evaluation results |
| Approved resolution memory / controlled-learning example | Existing finalized exception history is a foundation; sanitized searchable precedent is optional P4r, broader pattern/rule proposals post-event |
| Agent Activity Record / retrieval audit | Existing AIExecution/audit can be extended; new evidence fields and UI projection planned |
| Enterprise RAG/multimodal/LangChain | Post-event or optional evaluated adapter; not a hackathon prerequisite |
| P5 audit screen/e2e/video/submission | Draft phase spec now in `phases/P5.md`; implementation not started; `test:e2e` currently a placeholder, not a working smoke suite |

| Gate | Existing control and reuse | Retrieval addition / gap |
|---|---|---|
| Input | `core/ai/inputs`, import schemas/anonymisation, `server/auth`, tenant-scoped repositories | Bound knowledge/text/query sizes; sanitized knowledge and query builder |
| Retrieval / evidence | Policy clause references, import provenance, encrypted configuration clauses, exception record IDs | Approved/effective knowledge retrieval and persisted evidence package are new |
| AI output | `core/ai/index.ts` `runValidated`: schema, check callback, max two repairs, human-review fallback; `core/validation` config checks | Add retrieved-ID allow-list, provenance and supported structured-claim checks |
| Policy / business rule | Catalog/config versions, deterministic reconciliation and engine, config lifecycle | Verify citations against run's pinned approved configuration; semantic matches cannot redefine rules |
| Authorization | Guarded handlers, active-company membership, roles, MFA and repository company predicates | Reuse for evidence reads/ingest; background jobs derive scope from persisted entities |
| Human approval | Human config/exception decisions; payroll approval binds calculation hash; separate payment authorizer | Evidence absence/conflict/unknown support remains human review |
| Execution | Immutable calculation/obligation, plan hash, one payment gate, committed PayrollGuard entries | No retrieval in calculation, authorization or execution logic |
| Outcome / settlement | Arc receipt matching, recovery/idempotency, audit correlation | Link retrieval/proposal/decision to existing deterministic outcome |

`src/core/ai/recon.ts` currently checks exception refs, uniqueness/completeness and allowed actions. It does **not** carry retrieved policy citations or prove factual support. Config validation checks numeric support in cited clauses and flags unsupported values for explicit HR confirmation; this is not general semantic entailment. RAG must not turn an unsupported interpretation into an accepted claim by merely citing an existing chunk.

`ai_executions` already holds company, correlation ID, operation, input reference, schema/prompt versions, provider/model, output, validation, retries and status. `recordExecution` writes a linked audit event. Existing exception rows hold structured evidence, action, resolver and timestamp and protect finalized resolutions. Reuse these; no second event store.

## 4. Smallest database proposal

**No migration in this task or in the active P4g authentication phase.** If P4r is approved and passes its privacy/design gate, create an additive migration via the repository's Supabase migration workflow on dev; run DB/security checks before any prod application. Supabase pgvector only. The request's isolated “pgvector/Pinecone migration” wording is superseded by its explicit Supabase-only requirement.

Minimum: enable `vector`, add **two tenant-scoped tables**, and one bounded retrieval query/function. Names are proposed; refine during phase specification:

| Table | Minimum fields / relation |
|---|---|
| `knowledge_sources` | `id`, `company_id`, source kind and approved source/config reference, immutable `document_version`, content hash, approval state and human approval reference, `effective_from`, nullable `effective_to`, created timestamp; one row per immutable source version |
| `knowledge_chunks` | `id`, `company_id`, composite source FK, clause/reference ID, content hash, encrypted text or reference to existing encrypted clause, embedding provider/model/version-or-alias, dimension, preparation version, corpus generation, `embedding vector(768)`, created timestamp; unique source-version/clause/generation identity |

Metadata inherited through the source join (type, document version, approval, dates) belongs in every returned chunk contract; avoid duplicated mutable approval fields. IDs, hashes, dates and safe descriptors are metadata, not the vector's provenance. Refer to existing `payroll_configurations` and clauses until P4c creates a document model; do not assume `policy_documents` is already built.

Requirements: RLS on both tables, no anon grants, authenticated access read-only and scoped using existing active-company/membership conventions, server repository writes only, composite `(company_id, id)` FKs, effective interval CHECK, unique constraints for idempotent ingest, immutable approved source/chunk content. Lifecycle approval/revocation changes are separately audited and never rewrite old content. Source re-checks must exclude revoked generations without changing approved operational history.

Prefer a `SECURITY INVOKER` query/RPC with explicit company, eligible source versions, approval, period and model/dimension predicates in **each candidate-producing query before ranking/LIMIT**. Revoke default PUBLIC execute grants; grant only the roles required by the selected repository path. A service-role call bypasses RLS, so SQL predicates plus server-derived company identity are mandatory too. A user-client call must still enforce active-company scope. Views use invoker security; no public vector export or cross-tenant search function.

Use exact vector distance over this small filtered corpus first; an ANN index is not required to claim pgvector support. Add HNSW only if measured latency needs it and its filtered recall passes the fixtures. Compare 1536 dimensions in isolated evaluation storage/generations, then migrate the chosen shape if justified; do not create two permanent production indexes or compare vectors from different models/dimensions/preparation versions.

Avoid extra tables initially:
- `embedding_jobs`: synchronous bounded seed/ingest suffices; add durable jobs only for demonstrated retry/volume needs.
- `retrieval_events`: append safe retrieval-start/result/validation events to existing `audit_events`, correlated with AIExecution. Store an immutable package reference/hash, returned/cited IDs and configuration/version descriptors through these existing structures; no raw query or clause text. Final validation is a new event, not an UPDATE of the earlier immutable event.
- `approved_resolution_patterns`: optional sanitized projection of finalized exceptions first; add a reviewed immutable projection table only if storing/searching approved summaries requires it. A proposal cache or an ACCEPTED AIExecution is never trusted precedent.

Company deletion currently discovers public tables with `company_id` and deletes in FK order. Add deletion tests for both new tables and retrieval artifacts rather than assuming discovery handles everything; do not weaken append-only triggers. Future private-schema tables require explicit deletion coverage. Deleting the data key cannot erase readable vector/index backups: document retention/purge limitations before real data use.

## 5. Provider-agnostic contracts and retrieval flow

Define contracts in `src/core/knowledge/` with plain domain types and no SDK imports:

| Contract | Responsibility |
|---|---|
| `EmbeddingProvider` | Embed approved sanitized text/query; return vectors plus model identity, dimension and preparation metadata; never accept arbitrary payroll rows |
| `KnowledgeRepository` | Retrieve immutable source/chunk metadata by scope/ID, persist approved ingestion via server adapter; no financial mutation methods |
| `Retriever` | Retrieve ranked eligible references using mandatory company, period, pinned config/source generation, exact IDs, safe query and bounded K |
| `EvidenceRetriever` service | Orchestrate retriever + repository + structured-record lookups; build/validate an evidence package. Start as a service depending on those contracts, not an extra redundant port |

`src/server/knowledge/gemini-embedding.ts` implements the embedding port; `supabase-retriever.ts` uses pgvector and the SQL-scoped eligible set; `src/server/db/knowledge.ts` owns persistence/decryption. Server composition, not pure core, does I/O. Extend existing typed AI inputs and existing `AiSpec.check`; validation never imports the AI layer. Financial code remains unaware of all these adapters.

### Implementation contract sketch (specification only)

Refine concrete TypeScript names during the approved phase; these shapes do not add a runnable module:

```ts
type RetrievalScope = {
  companyId: string;              // derived from authenticated actor/job entity
  runId: string;
  workerId: string;
  period: { from: string; to: string };
  configVersion: number;          // read from this run, never supplied as authority by AI
  corpusGeneration: string;
};
type EmbeddingIdentity = {
  provider: string; model: string; modelVersion: string | null;
  dimension: 768 | 1536; preparationVersion: string;
};
interface EmbeddingProvider {
  embed(input: { items: { id: string; safeText: string }[];
    purpose: 'QUERY' | 'DOCUMENT'; dimension: 768 | 1536 }):
    Promise<{ identity: EmbeddingIdentity;
      items: { id: string; values: readonly number[] }[] }>;
}
interface Retriever {
  retrieve(input: { scope: RetrievalScope; exactIds: readonly string[];
    safeQuery: string; k: number }): Promise<RetrievalResult>;
}
interface KnowledgeRepository {
  loadByIds(scope: RetrievalScope, ids: readonly string[]): Promise<KnowledgeEvidence[]>;
  ingestApproved(input: ApprovedIngestion): Promise<{ sourceId: string; generation: string }>;
}
```

`ApprovedIngestion` includes trusted actor/approval reference, source/config identity, immutable version/hash, effective range and sanitized numbered clauses. Repository operations verify that approval in authoritative records; an `approved: true` flag from a request is insufficient. The first bootstrap uses a bounded seed of existing approved clauses rather than a new general upload/editor page. New source versions require human approval; generation becomes retrievable only after all required chunks map correctly, so partially embedded documents never appear complete. Use unique source/clause/generation keys for idempotent retries; failed preparation never alters an earlier generation.

`KnowledgeEvidence` contains stable chunk/source/clause/config IDs, tenant, version, effective interval, approval reference and hashes plus safe decrypted text where needed. `RetrievalResult` contains returned references, embedding identity, retrieval config, completeness and either evidence-ready status or NEEDS_HUMAN_REVIEW with reason codes. Proposed reasons: `MISSING_EVIDENCE`, `WRONG_SCOPE`, `DISALLOWED_VERSION`, `NOT_EFFECTIVE`, `CONFLICT`, `INCOMPLETE`, `PROVIDER_UNAVAILABLE`, `INVALID_EMBEDDING`. These are new knowledge-domain reason codes, not changes to existing payroll/exception enums.

The EvidenceRetriever service binds exact structured records and creates the immutable package. The existing reconciliation output extension adds package ID, an existing allowed `action`, and typed `claims[]` with evidence IDs and approved rule/config reference. No amount/recipient/action tool is available. A deterministic claim validator supports only a small enumerated set whose factual predicates are available in records/config; a claim outside that set or reliant on ambiguous natural language is NEEDS_HUMAN_REVIEW. Record existence and a cited number alone cannot establish entailment. Persist the actual human-selected action through existing exception APIs, then link the later calculation via existing audit; the AI proposal never resolves automatically.

Flow: approved company knowledge → existing browser parsing / numbered clauses → structured versioned chunks → privacy approval → embeddings → Supabase storage → eligible metadata-filtered exact/lexical/vector retrieval → rank fusion → evidence package plus exact structured record references → AI interpretation → existing validation pipeline → human decision → existing deterministic result.

Exact known rule/clause IDs win before ranking and must pass the same tenant/version/effectivity checks. Missing or disallowed exact ID is an escalation, not permission to substitute a similar clause. Both lexical and semantic candidates use the same eligible set. Fuse ranks (e.g. reciprocal rank fusion); a score never overrides eligibility or required exact evidence. Ambiguous policy periods, overlapping approved sources, uncovered period segments or missing context escalate. Historically superseded documents may support a historical run only when that run explicitly pins the then-valid version; they cannot override the active version for a current run.

Evidence package: package ID/hash, company/run/worker scope as applicable, relevant period, config version, corpus generation, returned knowledge references and approved exact record references, source hashes and versions, retrieval configuration and status. Bind validation to this package; final decision must re-check revoked sources/stale versions before accepting the proposal. Company policies need no run FK; timesheet/leave evidence must belong to the correct run and worker.

## 6. Gemini Embedding 2 and LangChain

Official documentation reviewed 2026-10-05 confirms stable `gemini-embedding-2` and 768/1536 dimension options. Keep its model name only in the server adapter/config and preserve replacement through the embedding contract. Existing OpenRouter generative adapters remain separate; an embedding provider is not a generative-model fallback.

Use one clause per embedding result with strict ID/result mapping. The provider's multi-input aggregation means one embedding request containing unrelated clauses must not be mistaken for independent chunk embeddings. Validate finite numeric elements, exact dimension and bounded inputs; preserve alias and returned version if provided, never invent a revision when the API exposes none. Version query/document preparation and rebuild a corpus generation on any incompatible model/preparation change. Provider errors fail closed; valid exact evidence may still be used, but semantic failure never fabricates a match.

Compare 768 with 1536 using the same frozen evaluation queries, source eligibility, K and fusion configuration. Prefer 768 unless 1536 materially improves Kleeno retrieval while preserving all zero-failure safety targets and acceptable latency/cost. No benchmark-only decision; no multimodal ingest during MVP.

**LangChain recommendation: do not add it now.** The narrow text corpus, existing clause input path and native Supabase adapter are sufficient for a first implementation. This is a complexity assessment, not a completed performance experiment. Revisit an optional adapter for loading/chunking/composition/evaluation if measured implementation cost justifies it; removing that adapter must not affect calculation, validation, approvals or payments.

Primary references: [Google model](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2), [embedding API and preparation](https://ai.google.dev/gemini-api/docs/embeddings), [Supabase hybrid retrieval](https://supabase.com/docs/guides/ai/hybrid-search), [pgvector](https://supabase.com/docs/guides/database/extensions/pgvector). Supabase's generic hybrid example needs Kleeno tenant/version predicates and grants; do not copy it as a secure application query.

## 7. Privacy, risks and unresolved design gate

The corpus allows approved policies, procedures, rule descriptions and sanitized human-approved resolution summaries. Exclude employee names, bank/wallet data, raw payroll CSVs, unrestricted compensation and arbitrary notes. Keep authoritative payroll records in structured storage; use only needed pseudonymous exact references in AI inputs. Query text needs the same privacy boundary as embedded documents; start with a structured exception task, not an unrestricted chat box. Provider credentials stay server-side, never `NEXT_PUBLIC_*`.

**Open design decision before P4r:** S41/rule 50 encrypt policy fields. Plain `tsvector` indexing needs readable policy text, and vectors can disclose characteristics even if chunk text is encrypted. Existing policy encryption must not be weakened to implement search.

Recommended hackathon option: approved **synthetic** text-only demo knowledge, original text encrypted, exact IDs filtered in SQL, bounded eligible ciphertext decrypted on the server for lexical ranking, and pgvector semantic candidates constrained by the same metadata. This avoids a plaintext SQL policy index. Persisting searchable vectors still requires an explicit classification/privacy decision for the corpus under rule 50; no migration until resolved. Alternative: keep all eligible content/vector material encrypted and perform bounded in-memory retrieval after server decryption, recording pgvector as deferred. That preserves the current boundary but must not be described as SQL pgvector search. SQL full-text over a reviewed non-confidential derivative is a later option requiring explicit data classification; sanitization alone does not establish confidentiality safety.

Real business knowledge requires review of the **actual** provider product/tier's data-use, retention, logging and deletion terms before transfer. The [Gemini API terms](https://ai.google.dev/gemini-api/terms) distinguish unpaid and paid handling; unpaid-service terms warn against confidential/personal submissions. Do not assume payment means zero retention or that Gemini API and Vertex terms are interchangeable. Record the review and use synthetic fixtures until completed.

Other risks and mitigations: prompt injection in approved text (data delimiters/strict schemas); misleading valid citations (structured claim checks); stale/cross-tenant caches (scope+version keys and final re-check); policy conflicts (review); approximate-search misses (filtered recall tests/exact scan); poisoned precedent (finalized human-only source); dimension/model drift (separate generations); latency/cost/rate limits (bounded corpus/K/timeouts); audit leakage (IDs/hashes only). Evidence validity is necessary, not a proof that arbitrary prose supports a claim.

## 8. Memory, controlled learning and transparency

| Product memory | Meaning | Authority |
|---|---|---|
| Knowledge | Approved policies, procedures and configuration documentation | Evidence for proposals; approved config remains the executable rule source |
| Resolution | Finalized human-approved exception/correction decisions | Precedent labelled as historical advice; never a rule or authorization |
| Operational history | Runs, hashes, approvals, obligations, payments, settlement and audit | Authoritative structured facts; immutable under existing controls |

These are separate from development-session memory in `docs/memory/`. None grants AI permission.

**Learning creates proposals, not authority.**

Controlled learning: exception → human evidence review → finalized human decision → immutable raw history → sanitized context/summary projection → retrieve similar approved cases → AI recommendation → evidence/rule validation → human decision. Repetition may propose an automation rule later; humans must approve a new immutable config version before it grants authority. No automatic policy mutation, model-weight updates or fine-tuning. Rejected AI suggestions never become precedent; when a human chooses a different action, only the actual finalized human action can become precedent. Merely resolving an exception does not prove a downstream outcome succeeded; bind the outcome separately and exclude unfinalized/failed cases from trusted patterns.

Resolution projection fields: company, source exception/category, sanitized factual features, relevant rule/config version, evidence references, actual human resolution, resolver, timestamp, verified outcome and optional sanitized summary/embedding. Retain immutable raw history; do not embed free-form resolution notes.

Preserve rule 5: MVP generative prompt free text is still approved policy clauses. Supply optional precedent as typed IDs/facts/enums through `core/ai/inputs`; any embedding summary is a reviewed deterministic template over those sanitized features, never the resolver's note. Broader approved procedures/summaries require an explicit schema/privacy extension before entering AI prompts.

Agent Activity Record reuses AIExecution + audit + linked entities: operation/task/status, evidence, rule/config versions, provider/model, proposals, validation checks/reasons, permission/role used, human decision, deterministic result, correlation/trace ID. Show structured actions/outcomes, never private chain-of-thought. Ranking scores remain internal signals; UI shows concrete checks (source exists, effective, exact rule present, scoped, conflict-free) and “Human review required”.

Retrieval audit must reconstruct task/query reference/hash, corpus generation and eligible source versions, returned IDs, cited subset, embedding model/preparation/dimension, retrieval configuration version and final validation status, all linked to AIExecution/decision by correlation ID. No raw sensitive text in audit payloads.

## 9. MVP, tests and implementation sequence

Conditional MVP: small approved policy corpus, embedding port/server adapter, Supabase scoped exact+semantic retrieval and bounded lexical ranking where practical, evidence package, deterministic citation checks, visible provenance in **one exception recommendation**. Add one prior approved resolution only after the base workflow passes. Defer generic document platform, multimodal embedding, continuous jobs, automation-rule proposals, pattern table, fine-tuning and LangChain.

Demo: explain why an existing worker exception was flagged, show numbered policy/config rule plus exact timesheet/leave IDs, make a supported allowed resolution proposal, list validation checks and require human review; then let the existing engine calculate. Use the current six-worker fixtures. W003 is paid leave today; the user's unpaid-leave example is illustrative. If demonstrating unpaid leave, choose the fixture and existing `TREAT_AS_UNPAID_LEAVE` action explicitly in P4r; do not invent an enum or monetary AI answer.

Before code, add failing protected retrieval fixtures and acceptance cases:

| Scenario | Required outcome |
|---|---|
| Exact overtime clause / known rule ID | Required exact evidence found; exact match precedes semantic alternatives |
| Paid vs unpaid clauses with similar wording | Correct expected clause, or explicit review when unsupported |
| Superseded source vs currently pinned version | Old version cannot override eligible current source; historical run uses only its pinned valid version |
| Company A content in Company B task | Zero A references, including service-role SQL path |
| Paraphrased policy question | Expected evidence in top K |
| Missing exact rule / no supporting source | `NEEDS_HUMAN_REVIEW`; no invented replacement |
| Conflicting approved sources / partial effective period | `NEEDS_HUMAN_REVIEW`; ranking cannot resolve authority |
| Existing citation with wrong worker/run, hash or version | Rejected before proposal acceptance |
| Cited ID absent from supplied package / unsupported structured claim | Rejected; schema-valid output is insufficient |
| Similar finalized approved case | Visible precedent only; review still required |
| Rejected suggestion or unfinalized/failed historical outcome | Never trusted precedent |

Metrics: Recall@K (fix K, proposed K=5), exact-ID hit/precedence rate, missing/conflict escalation rate, end-to-end retrieval p50/p95 latency and provider cost. Required safety counts: tenant-isolation failures **0**, disallowed/superseded-version overrides **0**, unsupported accepted claims **0**; required missing/conflict fixtures escalate **100%**. Fix recall/latency targets before tuning, report results for both dimensions, and keep a protected held-out set separate from development examples. Fixtures establish bounded behavior, not universal language correctness.

Test layers: core evidence-package/claim checks; provider fakes for unavailable/dimension/non-finite/mapping failures; DB RLS/IDOR, grants/RPC/company predicates, source immutability, effective/revoked versions, deletion and audit safety; protected injection and no-authority-boundary tests; one SIMULATION UI evidence smoke; regression of existing hash/approval/gate/guard/settlement invariants. Do not weaken any existing protected tests.

Order: docs/deadline (this task) → approve P4r and resolve privacy decision → failing fixtures → contracts/metadata → additive migration → provider → scoped retrieval → evidence gate via existing AI pipeline → evaluation → one demo workflow → optional precedent. LangChain only after evidence of benefit.

## 10. Dependency-aware schedule

Authoritative detailed schedule: `PRD.md` §12. Completed phase dates stay historical. The extension is mainly validation/demo time, not seven extra days for every phase.

- Oct 5: finish P4g provider spike/user check and normal phase closure; slice 2 remains cuttable.
- Oct 6–7: P4c policy/pay foundation, required tests; no RAG before source/config boundaries are clear.
- Oct 8: P4d dashboard; prepare P5 audit/demo path and protected retrieval evaluation design.
- Oct 9: optional P4b/planner and parked standing authorization only if safe; stable payroll/payment rehearsal is the core checkpoint.
- Oct 10: RAG go/no-go using stable core demo, approved P4r plan, privacy decision and provider readiness. If dependencies miss, keep RAG as roadmap; finish core/P5 validation.
- Oct 10–12: narrow P4r only if the gate passes; evaluate, integrate, feature freeze and `demo-freeze` on Oct 12. No unverified RAG claim in demo.
- Oct 13–14: P5 regressions, provider failures, isolation, evidence evaluations, permissions and real testnet smoke; backup before planned Oct 14 deploy; release rollback checks.
- Oct 15–16: demo rehearsal/video, README/security/status truth check, public-repo checklist, submission dry run. Aim to upload on Oct 16.
- Oct 17: final submission/portal confirmation, contingency fixes only. Precise organizer cutoff time/timezone remains to be confirmed.
