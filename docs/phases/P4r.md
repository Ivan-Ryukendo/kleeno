# P4r — Evidence-grounded exception recommendation

Status: **in progress**, owner-selected synthetic-first (2026-10-05). On 2026-10-06, local synthetic retrieval passed 9 focused tests and all 11 evaluation cases at 768 and 1536 dimensions. Recall@3 and exact-ID precedence were 1.0; all three missing/conflict cases escalated; tenant/version/unsupported-claim safety counts were zero. These results cover token-hash-v1 behavior only, not external embedding quality. No real vector or lexical storage or provider adapter is enabled; privacy/storage approval, provider data-use review, database/tenant integration, and phase acceptance remain open. See ../p4r-synthetic-evaluation.md. Full design/review: `../evidence-grounded-ai.md`. Depends on approved source/config boundaries from P4c and a stable existing payroll/payment demo. Target Oct 10–12; submission Oct 17, 2026.

## Goal and entry gate

Show one evidence-backed exception recommendation with valid policy/config and exact structured-record references, deterministic validation and human decision, followed by the unchanged payroll engine. SIMULATION default; AI supplies no final monetary amount.

Owner approved synthetic-first implementation. Evaluate only synthetic knowledge until the encrypted-policy/searchable-vector decision and actual provider data-use/retention review permit real business data. Select an existing enum-compatible fixture; do not silently change W003's paid-leave scenario.

Oct 10 go/no-go: core payroll/payment smoke passes, P4c evidence model is stable, privacy/storage choice is approved, provider readiness and evaluation targets are established. If any gate fails, defer P4r and use the existing demo. No extra financial or payment infrastructure.

## Slices and TDD

1. **Fixtures and contracts:** protected ten-scenario retrieval set (see evidence plan §9), isolation/claim failure cases first; core knowledge types, three ports and EvidenceRetriever service; strict AI evidence input extension; provider fakes.
2. **Metadata/storage:** minimum two-table additive migration and vector extension only after the privacy decision; RLS/read-only grants, composite FKs, scoped RPC, immutable approved content, deletion coverage. Start bounded exact distance, no ANN index by default. Dev only until normal migration checks/authorization.
3. **Retrieval:** server-only Gemini adapter, 768 default; tenant/version/effective metadata inside SQL candidates before ranking; exact-ID priority; privacy-compatible lexical + vector fusion; evidence package and audit refs.
4. **Validation/evaluation:** use existing validated AI pipeline; cited subset/provenance, supported structured claim and pinned-rule checks; missing/conflicting evidence → NEEDS_HUMAN_REVIEW. Run fixed 768/1536 comparisons; no result claims without measured fixtures.
5. **UI/demo:** existing exception evidence panel + AIExecution/audit record shows sources/versions/checks and human decision; deterministic calculation remains unchanged. Optional one approved historical precedent after all prior slices pass.

Backend follows existing backend/phase instructions; UI follows DESIGN. No new dependency unless justified by current primary docs and repository review. LangChain deferred. Every slice begins with expected failing checks, ends with passing checks and refactoring; never weaken existing protected tests.

## Security rows / Done when

Copied from `docs/security.md`; all are **planned**, not verified.

| ID | Required check and expected result |
|---|---|
| S76 | `db/knowledge`: RLS, read-only public grants, active-company/IDOR and service-role scoped SQL; no foreign tenant in candidates/results |
| S77 | `db/knowledge`, `inv/knowledge/retrieval`: approved/pinned/effective versions only; exact-ID priority; revoked/conflicting/missing sources rejected or escalated |
| S78 | `inv/knowledge/evidence`: cited retrieved subset, source/hash/clause/worker/run checks and supported structured claims; unsupported output NEEDS_HUMAN_REVIEW |
| S79 | `inv/knowledge/privacy`, provider-fake unit checks: approved sanitized text only, no notes/raw CSV/PII, server-only credentials, dimension/model mapping failures closed; rule 50 decision recorded |
| S80 | `db/knowledge`, `inv/knowledge/audit`: returned/cited IDs and safe config metadata linked to immutable AIExecution/audit; no sensitive raw query/content |
| S81 | `inv/knowledge/memory`: finalized human-approved precedent only, rejected/unfinalized cases excluded, proposals grant no authority; original history unchanged |
| S82 | protected fixtures + comparison report: zero tenant failures, disallowed version overrides and unsupported accepted claims; missing/conflict escalation 100%; Recall@K and latency measured for 768/1536 |

- Existing S21–S23 AI boundary/injection, S41 encryption and S44 deletion tests remain passing; new tables and retrieval artifacts included in deletion assertions.
- Existing unit/invariant suite, DB suite, Foundry guard tests, lint, typecheck and build pass as applicable. One UI evidence smoke passes; existing payroll/payment path still works when embedding/generative provider fails.
- No calculation/approval/payment code depends on a retrieval provider. Approval hashes, four-eyes, immutable obligations, PayrollGuard, settlement and SIMULATION checks remain intact.
- User sees the working slice; security statuses record actual checks/limitations; update PROGRESS and file map; follow normal branch/PR/CI phase closure. Do not claim real-cloud verification from fakes.

## Cuts and exit

First cut prior-case demo → generic lexical index/ANN optimization → semantic retrieval/P4r entirely if the core checkpoint or privacy gate fails. Keep existing explicit evidence UI and financial controls. Stop adding features at Oct 12 freeze; incomplete slices go to roadmap with an honest status. P5 receives evaluation results and the tested demo path, not an unchecked RAG promise.
