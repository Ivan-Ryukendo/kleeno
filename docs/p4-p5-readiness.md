# Kleeno — P4 completion and P5 readiness

Updated 2026-10-06 against the owner-approved P4 mission and local implementation. Submission deadline **October 17, 2026**; feature freeze **October 12**. Deployment, cloud migrations, publication and payment execution retain their separate gates.

## Current progress level

### October 6 parallel completion continuation

Owner selected October 17 product plus agreed UI updates and authorized consolidated testing after construction. Three implementation workers completed backend, experience and browser intake lanes, followed by independent integrated review.

- Config activation now atomically validates an approved tenant/role-bound target, replaces the active version and audits transitions in one transaction. New migration `20261006000001_atomic_config_activation.sql` must follow the four pending October 5 migrations before activation/seed/browser execution.
- Password-first login, exact amount-to-trace anchors, source/inputs/rule-version display, responsive trace/variance tables and contextual worker-history links are implemented. Run/config read failures fail closed instead of displaying absent calculation data.
- Company deletion preserves shared global sign-in identities; deleting a workspace does not revoke other-company access. Public privacy text now describes authorized payroll pilots, AI/testnet boundaries and honest backup/deletion limitations.
- Real-app synthetic intake acceptance covers policy upload/human approval, CSV/XLSX mapping, name privacy, currency rejection, calculation/variance, payment denial and DB-backed comments/layout reload. It uses an encrypted synthetic AI cache and blocks external provider calls; not live inference evidence.
- Draft demo script, honest traction inventory and model-evaluation report now exist. No measured traction, real model results, recorded video or submission is invented.
- Consolidated local unit/invariant suite: **475 passed in 60 files**. Lint, typecheck and production build pass. Typecheck first encountered malformed generated `.next/dev/types`; regeneration resolved it without changing application behavior. Local Foundry/solc binaries exist under `.tools`; **14 contract tests pass**, including 256 fuzz runs.
- Owner selected isolated GitHub CI on a reviewed build branch for DB/full-browser execution. Branch is `codex/p4-p5-completion`; no merge, cloud migration, public visibility switch, deployed rehearsal or financial execution is implied. Browser harness and secret scan results are recorded after their final checks.

Historical results below remain historical; phase closure still requires applicable isolated/deployed/provider and owner acceptance.

Final local integrated production build passed after the native dialog-focus fix. Styled browser harness passed password/MFA, keyboard disclosure/trace, direct/context-menu Comments focus, ordering/layout requests and 375px containment. Playwright discovers two tests; actual isolated browser execution remains for CI. Full-history secret scan passed 217 commits after internally verifying eight identical synthetic receipt-test fallbacks and recording only their exact historical fingerprints. Staged scan passed (844 KB); no secrets or local tooling staged. Scanner exclusions do not cover future commits or other files.

**The payroll/payment foundation and core P4 are merged. The remaining P4 extensions are partly built or planned. P5 release readiness is not complete.** A single percentage would conflate code, external verification and optional features; use the observable phase states below.

| Area | Observed state | Work remaining |
|---|---|---|
| P0 setup / P1 guard and payment / P2 foundation | Commits present on main: `f95edfd`, `05929b6`, `820d798`; P1 review fixes `76b44bc` | Recheck external settings in final release; historical proof is not a current production check |
| W waitlist | Recorded live Oct 1; public app remains waitlist by existing plan | Verify public/privacy/contact pages for final release; app-mode launch separate |
| P3 data + AI | Merged `0c4e131` Oct 2; policy proposals, CSV/reconciliation, calculations, variance and basic table views | Previously cut views/worker setup remain cut; `/privacy` business-data note still open |
| P3b company system | Merged `296354e`; git timestamp Oct 2, earlier notes labelled Oct 3 | No rebuild; validate invites, membership, onboarding and company switcher in release smoke |
| Core P4 payments | Merged `c0305d0` Oct 3; slices 1–4, 6, 7 and receipts implemented | Remaining live verification, trace coverage and production setup; standing authorization parked |
| P4u shell | Merged with P4; previous browser check recorded | Confirm success-green decision and post-check hydration fixes; rehearse live-state screens |
| P4g Google sign-in | Slice 1 locally built on `p4g-google-auth`, uncommitted; S74 unverified | Real Google/Supabase setup + browser spike, phase checks/closure; slice 2 optional |
| P4c policy + pay | Local extraction/import, scoped policies/cache, pay additions/proration and resource-column backend implemented; local tests pass | Additive migrations and DB/privacy/browser acceptance remain unverified; phase closure is open |
| P4d dashboard | Dashboard/history and configurable table implemented locally; accessibility/browser work in progress | Finish formula/comment/reorder acceptance and owner browser review; no deployed proof yet |
| P4b planner + standing authorization | Selected; validated planner, human fallback and standing server paths/controls implemented locally | Independent review, focused tests, additive schema and DB/live acceptance remain open |
| P4r evidence retrieval | Selected synthetic-first; local in-memory retrieval/evidence checks and 768/1536 synthetic evaluation implemented | See `p4r-synthetic-evaluation.md`; real searchable storage/provider/privacy and DB/UI integration remain gated |
| P5 demo + submission | Audit UI, bounded local-only SIMULATION seed, S33 DB trace test and Playwright workflow authored | Execute isolated DB/browser suite; finish evaluations, live provider evidence, release/video/submission |

## What changed in the deadline/strategy update

- Submission moved from Oct 10 to **Oct 17**; dependency order remains P4g → P4c → P4d → optional P4b → conditional P4r. P5 readiness work starts before feature freeze.
- Freeze/demo-freeze moved to **Oct 12**, planned backup/deployment window to Oct 14; Oct 13–16 is mainly testing, evidence evaluation, demo and polish.
- Position is **Verified Payroll Automation**, with Evidence-Grounded AI and Controlled Learning documented above existing deterministic controls. This was a documentation/specification change, not a shipped RAG feature.
- Added provider-agnostic retrieval/metadata specs, conditional P4r plan, planned S76–S82 controls and durable memory. Native Supabase first; LangChain deferred.
- This review corrects stale phase headers/resume notes and adds a concrete P5 handoff. Historical progress notes remain in `memory/build-history.md` rather than being mistaken for current status.

## Oct 6 continuation evidence

- Fresh typecheck and lint passed; the initial full unit/invariant run passed 461 tests in 57 files. Final post-review checks are recorded in PROGRESS/memory.
- Synthetic table browser acceptance passed using the real Kleeno stylesheet: hover/focus formula disclosure, direct/context-menu Comments focus, HTML drag order and personal-layout save requests. Mock APIs do not verify tenant authorization or persisted database state.
- Current retrieval checks passed 9 tests; 11 fixed synthetic scenarios passed at both 768 and 1536. See `p4r-synthetic-evaluation.md`; these are token-hash measurements, not real embedding quality.
- Playwright discovers one SIMULATION workflow test. The local-only seed, S33 trace and P4b database tests are authored but not executed: no local Docker/psql stack is available, and `.env` targets remote dev.
- Ordered additive migrations `20261005000001` through `20261005000004` are unapplied. No cloud migration, deployment, commit/PR, provider smoke or payment was performed.

## Historical Oct 5 evidence (superseded by Oct 6 continuation above)

| Check on Oct 5 | Result |
|---|---|
| `npm test` | **366 passed**, 40 files; default config excludes `tests/db` |
| `npm run lint` | Earlier pass superseded by completion-planning rerun: fails on local git-ignored `.agents/skills` CJS scripts (15 errors/1 warning); plan Task 0 adds tooling-only exclusion |
| `npm run typecheck` | Pass |
| Local Foundry with pinned repo compiler | **14 passed**, including 256-run fuzz payout test |
| DB/browser/live/cloud/build/remote CI checks | Not rerun in this status review; no readiness claim from the local tests |

Completion-planning rerun also passed `npm test` and typecheck (no new application code); the original exact test/Foundry counts above remain that earlier run's evidence. Draft parallel ownership and acceptance: [`plans/2026-10-05-system-completion.md`](plans/2026-10-05-system-completion.md). User confirmed local normal-file extraction then encrypted compact text storage, MD/TXT/DOCX/text-PDF first, scans flagged OCR; owner mission and DOCX bounds were subsequently approved. Kimi binary installed/verified in ignored `.tools/kimi-webbridge` using an inspected path-adapted installer with `-NoStart -NoSkill`; help/status/ignore checks pass. Daemon remains stopped, extension/version compatibility unverified, default runtime state profile-based; no connected browser claim.

The Oct 6 continuation authored an actual Playwright runner/workflow, `/audit`, a local-only synthetic seed and S33 DB trace test. Browser discovery passes; isolated DB/browser execution is still pending. Final demo/traction/model-evaluation and release artifacts remain open. Gateway top-up and receipt-link UI are already wired in `settlement-actions.tsx` and the settlement page; do not list them as missing implementation just because old slice notes predate them.

## Next steps, in order

### 1. Close the active Google sign-in phase

Agent: preserve current OAuth changes; run full phase checks against a disposable DB/normal approved dev process, build, waitlist-mode probe and browser flow; record actual S74 result; commit/PR/CI/merge through normal workflow after review. MFA query parameters are already consumed by the login page/form; the old “needs UI wiring” note is superseded.

User/external setup: configure Google OAuth and the Supabase provider/allowed callback URLs without sharing secrets in chat. Required real checks: unknown Google email refused with sign-up off, matching invited email keeps the same user ID, membership and MFA still apply, admin rejects Google-only sessions. Optional Google invite/TOTP alternative is slice 2 and can remain deferred; do not let it delay core work.

### 2. Verify the approved P4c policy/pay implementation

Owner-approved P4c is implemented locally; finish S69–S73/S42 DB/browser acceptance and migration review. Required foundations: browser-only safe document parsing into numbered encrypted clauses, exact version references, deterministic scope/precedence with HR-confirmed overrides and same-level clash rejection. Then approved Excel import/cache and HR-entered additions/deductions with immutable snapshots/hash/trace; use the owner-confirmed inclusive actual calendar-day proration for salaried/retainer workers. Use failing fixtures before code, then refactor. Part-period pay remains cuttable under PRD §12. No embeddings in this phase.

### 3. Verify the approved P4d dashboard and table

Owner-approved P4d is implemented locally using the existing shell and scoped repositories; finish deployed browser/owner acceptance. Deliver period selection, meaningful totals/to-dos, linked AI/audit activity, run table and per-worker history. Use testable role/scope acceptance and browser checks. Motion embellishments are the first cut; keep the required working dashboard.

### 4. Make the planner/standing-authorization scope explicit

P4b is selected under the owner-approved all-P4 mission. The validated planner and standing paths are implemented locally; finish database acceptance and live verification before closure. Test S09 eligibility, four-eyes, expiry/revocation and provider fallback. **Fallback plans cannot use standing authorization.** If cut, retain human-signed deterministic fallback and remove unattended-clean-run claims from the video/README; do not relax rule 25.

### 5. Prove core P4 readiness by Oct 9

- Demonstrate one UI LIVE_TESTNET run using two different members: payroll hash approval → plan sign → guard commitment → resumable execution → independent Arc match → RECONCILED. Repeat/recover and confirm no duplicate payment; test hold/release and kill-switch behavior.
- Execute the authored **S33 `db/trace` acceptance test** against an isolated migrated database: each request carries its own correlation ID downstream, and immutable entity references connect AIExecution/audit, approval, obligation, attempt/Circle reference, transaction and settlement across separate requests. Do not invent a requirement that all lifecycle requests share one correlation ID. Current carried IDs are not an end-to-end proof.
- Run remaining DB checks, build and CI through the normal phase workflow. Preserve protected invariant/Foundry tests; record limitations rather than blanket-marking all controls verified.
- External prerequisites: testnet USDC/gas; Circle webhook registration; Production receipt/x402 secrets where used; Auth/MFA settings and data-key backup. These are recorded pending setup, not independently checked here.
- Production migrations require the existing explicit authorization and ordered review, not an automatic push. Prod currently serves the waitlist per notes; do not equate merged code/dev schema with a live payroll product.
- Gateway (S67) and x402 (S68) need real provider smoke if included in the demo. Their fake-backed tests already exist. Gateway needs source-chain funds/gas; x402 needs seller configuration and funded buyer balance. Defer the demos if they cannot be verified safely.

### 6. Use the RAG go/no-go gate, not the whole extra week

On Oct 10, decide against `phases/P4r.md`: stable core demo, approved source boundaries, approved searchable-vector/encrypted-policy handling, provider readiness and fixed evaluation targets. If all pass, implement only Oct 10–12's evidence workflow. If not, keep it as roadmap and spend the window on P5. No P4r task is a prerequisite for starting P5 preparation. Optional approved precedent is cut before the base evidence slice.

### 7. Start P5 preparation now and finish after freeze

Draft specification: `phases/P5.md`. Begin inventory, synthetic demo fixtures, trace-test design, audit view design, evaluation checklist and video outline while P4 finishes. Implement via its approved phase workflow; readiness preparation is not permission to publish/deploy.

P5 deliverables: tenant/role-scoped read-only audit timeline, reproducible six-worker demo seed, **real** SIMULATION e2e smoke, guarded LIVE_TESTNET smoke, model/evidence results for included features, truthful README/traction/data note, final security statuses and accepted limitations, backup/deploy/rollback checks, judge access, <3-minute video and submission confirmation. Keep passwords out of README and public artifacts; demo/sandbox companies cannot pay.

## Timeline and exit criteria

| Date | Target |
|---|---|
| Oct 5 | Close P4g if real external checks are ready; start P5 readiness inventory |
| Oct 6–7 | P4c; specification and regression checks before implementation |
| Oct 8 | P4d; P5 audit/e2e/demo preparation |
| Oct 9 | Stable core payroll/payment checkpoint; optional P4b decision |
| Oct 10–12 | Conditional P4r or P5 hardening; **feature freeze/demo-freeze Oct 12** |
| Oct 13–14 | P5 regressions, DB/trace/model/evidence evaluations and live smoke; backup before planned deploy |
| Oct 15–16 | Rehearse/video, final docs/hosting/public-repo checks; aim for submission upload Oct 16 |
| Oct 17 | Confirm submission and live judge access; exact organizer cutoff/timezone still to be checked |

P4 handoff is ready when core path checks pass, retained P4c/P4d features pass their own acceptance, planner/standing and RAG are either tested or explicitly deferred, and verification/setup gaps are named with owners. P5 can start preparation immediately; final P5 completion requires the shipped demo and submission gates, not merely code merge. If dates slip, apply existing cuts and preserve the Oct 12 freeze rather than consuming all validation time.
