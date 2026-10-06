# Next build review and bounded foundation-verification draft

Reviewed October 6, 2026 (Asia/Dhaka). Owner requested review of both hackathon and commercial plans before choosing. Three read-only subagents reviewed foundation, commercial dependencies and experience. This document proposes work; it does not approve a new implementation phase, cloud migration, deployment, publication or payment.

## Recommendation

Select [roadmap Step 1](../roadmap.md#step-1--verify-the-existing-foundation) next. It serves both releases: verify the existing payroll foundation before extending it. Continue P5 preparation alongside verification. Prepare commercial discovery/design briefs in parallel, then select commercial implementation after the foundation evidence and owner review.

Keep October 9 core checkpoint, October 10 retrieval decision, October 12 freeze and October 17 submission. Organizer cutoff/timezone remains unconfirmed. Commercial review complements an existing payroll provider; production United States payroll remains a separate programme.

## Findings that change the work queue

| Finding | Evidence | Next action |
|---|---|---|
| P4 extensions exist locally; acceptance is the main gap | [readiness inventory](../p4-p5-readiness.md), [DB handoff](../p4-database-acceptance.md) | Execute acceptance before commissioning replacements; repair observed failures only |
| Four additive migrations remain unapplied; local Docker/psql/Forge were not found during this review | DB handoff; command availability inspection October 6 | Establish an isolated execution target; do not use remote `.env` as a disposable database |
| CI build and browser jobs are already authored | `.github/workflows/ci.yml:78-84`; `docs/phases/P5.md:37` still says missing | Reconcile stale P5 wording; execute/review CI evidence, do not add duplicate jobs |
| Existing browser smoke starts from seeded data | `tests/e2e/payroll.spec.ts:11-19` | Add browser intake acceptance for policy upload/config review/import; seeded exception/calculation smoke does not prove intake |
| P5 script/traction/model report files are absent | `docs/phases/P5.md:18`; October 6 docs listing | Prepare these artifacts using real evidence; never invent participants, savings or model results |
| Commercial graph needs an agreed review-state contract first | roadmap Steps 4/6; `ARCHITECTURE.md:445` | Specify states/actions during Step 3; implement lifecycle in Step 6 without extending SIMULATION or creating obligations |
| First paid review release excludes optional employee/API expansion | roadmap public-launch matrix and release boundary at line 264 | Select applicable paid-launch gates; Steps 8/10 need not block Step 11 for the narrower release |
| Table and policy services are reusable | `src/server/db/table-workspace.ts`, `src/core/views/index.ts`, `src/core/config/index.ts` | Verify comments/layout persistence and tenant checks; extend current precedence compatibly instead of building new engines |
| One personal layout is not full named/team saved views; formula strings are not complete calculation traces | `src/core/views/index.ts:139`; `src/components/table-view.tsx:304` | Select advanced-view scope explicitly; connect selected computed amounts to existing rule/version/input/intermediate-value traces |
| Existing admin Sign-ups counts leads; platform authentication is not granular support permission | `src/app/admin/page.tsx:61-70`; `src/server/auth/admin.ts` | Specify unique-account metrics and support/billing/operations capabilities before Step 7 screens |

This review identifies acceptance and specification gaps, not a confirmed new runtime defect. Code presence, local synthetic results, external configuration and deployed verification remain distinct.

## Step 1 draft: scope and execution

**Goal:** produce dated, environment-specific acceptance evidence and a small repair queue for existing retained P4/P5 behavior.

**Includes:** source/phase reconciliation; migration review; isolated DB acceptance; browser SIMULATION acceptance; auth/MFA and retained provider verification planning; existing control status and release prerequisites.

**Excludes:** new commercial UI, priority rules, review lifecycle, employee identity, billing, connectors, real embeddings, new monitoring vendors and production payroll. No speculative schema/API additions. Reuse existing tests, repositories, fixtures and CI.

1. Record branch/HEAD and existing dirty files before work. Review observed baseline was `p4g-google-auth` / `c0305d0`; preserve local OAuth/P4/P5 changes. Recheck at execution time.
2. Choose disposable local Supabase or the existing isolated CI job. Local execution needs suitable tooling; installation is not included here. Remote development acceptance is an alternative only through the explicitly reviewed target/backup procedure in the DB handoff. Never aim seeds/e2e at remote dev or production.
3. Review migration history and apply `20261005000001` through `20261005000004` in order to the approved isolated target. Preserve already-applied migration history. Record migration outcomes before running tests.
4. Run existing DB acceptance for OAuth, policy/cache/adjustments, resources/layouts/comments, standing authorization, demo repeatability and S33 trace. Keep failures intact; create a failing regression for any uncovered defect before its minimal repair. Never weaken protected tests.
5. Run the production build and existing browser smoke against that migrated local target. Extend intake/resource journeys only where required acceptance is missing. Verify keyboard/touch access and persisted permissions as well as mocked presentation behavior.
6. Parent coordinates real Google/MFA and retained Circle/Arc/Gateway/x402 evidence through existing approvals and setup. Two distinct approvers, funded testnet setup, guard/gate, recovery, kill switch and independent receipt matching remain required for live proof. No payment or provider execution is authorized by this draft.
7. Consolidate evidence by control/capability: environment, source revision, check, result, date, limitation, responsible owner and next action. Mark blocked checks explicitly; blocked is not verified and does not satisfy release acceptance.

**Data/API impact:** none planned. Existing four migrations are under acceptance; any repair changing a contract gets a scoped compatibility review. No customer data or secrets in evidence.

**Deployment/recovery:** no deployment in this review. Before later release, review application rollback and database recovery separately. Do not delete immutable snapshots/audit history to undo a feature. Investigate failed migrations before retrying; destructive restoration needs its own reviewed procedure.

**Exit:** all required retained capabilities verified with evidence or explicitly blocked with owner and next action; security/phase/progress records agree. Foundation release readiness additionally requires its mandatory gates to pass and owner acceptance. Refresh local regression checks sequentially after repairs; previous 463-test evidence is historical, not a fresh run from this review.

## Parallel work after phase selection

| Owner | Exclusive scope | Dependency / boundary |
|---|---|---|
| Database worker | Migration review, DB acceptance and evidence; observed DB/core repair proposals | Single DB execution owner; protected tests preserved; no cloud changes |
| Browser worker | Existing Playwright acceptance and missing intake/resource journeys | Can author checks in parallel; execution follows isolated migrated DB; no shared migrations/provider calls |
| Preparation worker | P5 artifact outline plus Step 2 pilot brief and Step 3 page/action acceptance map | Uses facts only; no outreach, invented traction or future UI code |
| Parent | Shared-file integration, security/progress/memory, external prerequisites and release decisions | Shared configs/dependencies edited only by parent; run heavy checks sequentially due recorded memory pressure |

Current subagents performed these reviews only. Implementation ownership is proposed, not dispatched. Do not create competing memory or audit systems; supply workers AGENT context and the selected phase scope. Independent spec/quality review and required owner browser review remain part of phase closure.

## Commercial build selection after verification

Smallest next commercial deliverable: Step 2 pilot brief plus Step 3 journey/action specification. Define the target customer/workforce, current review process and measured baseline before numeric improvement targets. Map existing routes into Dashboard / Payroll / All Workers, preserve deep links and auth, and specify loading/empty/error/stale/denied states before coding.

Resolve review sign-off/cutoffs/corrections/export before lifecycle code; priority range/effectivity/compatibility before policy extension; support permissions/metric definitions before admin work. Billing needs reviewed-worker event/timezone, bureau buyer, pricing/grace/refund/tax and demo/export/retention decisions. Employee identity and real retrieval each need their own privacy/access/deletion approval. Keep Postgres; monitoring is required but Grafana adoption is optional.

No additional decision is inferred from the request to review both. Select Step 1 execution or commercial discovery/design preparation after reviewing this draft.

Step 3 owner-review examples: HR import → exception → trace; payment approver holds → sign → settlement; company switch → worker history → source/comment. The route/action matrix includes role, run mode and preserved deep links. Password-first login is a future mapped change, not an auth rewrite. Keep current shared navigation and Kleeno tokens; success green remains an owner decision.

## Review validation

Read-only source/document review; no application, DB, browser, Foundry or provider tests executed. Documentation acceptance checks verify this report's links, Step 1 boundaries, dependency/worker coverage and PROGRESS length. Runtime statuses remain those in the readiness inventory until execution supplies new evidence.

Validation result: missing-report baseline failed before creation; 21 documentation checks passed after creation. PROGRESS is 28/30 lines. Scoped tracked-file whitespace validation passed; untracked review/memory whitespace is checked separately. This is documentation validation only.
