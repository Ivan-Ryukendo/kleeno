# Exact recovery manifest - 2026-10-10

R1.2 documentation deliverable; proposed ownership for R1.3 review, not slice implementation approval. Local task/integration merges follow [agent workflow](../agent-workflow.md) and [Git safety](../github.md); remote PR procedure and release remain separate. No source was changed or secret-file content inspected.

## Frozen inputs

Baseline `0eebda5526d7da2b279a97791afed496ad74f68d`; checkpoint `58555a9bed4d634e0f22f00f9e0bf97f17fbf416`; physical HUB HEAD `c9f7ae8c939084f3b3175b488379635e9edaae41`. Snapshot captured 2026-10-10T15:43:49.172Z. Baseline-to-checkpoint has **276 paths**. Physical HUB is intentionally dirty on task/R3.F1. Integration began ae3c1ae. New coordination files are not in baseline and must be read from HUB.

Inventory commands: git diff --name-status 0eebda5 58555a9; git ls-tree -r --name-only 58555a9; git diff --name-only 58555a9; git ls-files --others --exclude-standard; hash comparison for allowed nonsecret candidate paths. Ignored files are outside this manifest and never staged. Hashes describe content, not acceptance.

## Proposed ten slice groups

| Group | Task | Scope | Checkpoint paths |
| --- | --- | --- | --- |
| S1 | R1.4 | Tooling/CI/fonts | 9 |
| S2 | R1.5 | Incremental security tests/admin assurance; baseline Step-1 already present | 5 |
| S3 | R1.7 | Financial roles, completeness and unavailable-read guards | 18 |
| S4 | R1.8 | Review/readiness/tasks/history/workflow | 52 |
| S5 | R1.9 | Corrections/evidence pack | 20 |
| S6 | R1.10 | Effective compensation | 28 |
| S7 | R1.11 | Platform accounts/support/shell integration | 27 |
| S8 | R1.12 | Named views/help/API status | 14 |
| S9 | R1.13 | Stripe TEST billing | 35 |
| S10 | R1.14 | Docs/mockups/latest coordination overlay | 64 |

Exclusions: 4 paths (EXCLUDED-TOOLING, EXCLUDED-RESEARCH). Every path below has exactly one recovery owner or exclusion. Ownership means final full-file destination; shared hunk staging requires the separate dependency review below.

## Recovery order and blockers

- S1 first, followed by the verified S2 incremental delta. R1.5 cannot repackage the Step-1 fixes: baseline 0eebda5 already contains them. S2 has new hardening tests/admin checks rather than an empty duplicate PR.
- Proposed S3 first preserves privacy, but its complete workers reader references effective_compensations (S6), table view/client changes interact with S8, and shared run/dashboard surfaces reference S4. Recover privacy-only hunks against baseline first, then integration hunks with their feature owner; alternatively combine dependency-coupled slices in an approved card. Do not copy shared full files early.
- S4 payroll-review UI imports S5 corrections/evidence and S4 signoff logic interacts with S9 billing; S5 imports S4 review/readiness. These are coupled groups. Exact source edges below establish where full-file recovery needs prerequisite/hunk handling. Typecheck each intermediate tree before claiming independent slices.
- Follow filename timestamp for migrations, regardless of slice review order. R1.6 must verify financial-role SQL on baseline and ordered final schema with disposable DB evidence. No migration is applied by this task.
- Current R2.1 dependency on R1.7 cannot establish all-42-migration acceptance before the other recovered migrations exist. Proposed prerequisite correction belongs R1.3/R2 card; ledger dependencies unchanged.
- S10 recovers documentation using latest approved HUB overlays, not stale checkpoint progress/roadmap/memory. Research files remain locally preserved and excluded pending commit classification. .env.example is template-only and needs staged scan/review; actual .env files are outside scope.
- R3.F1 c9f7ae8 changes only tests/unit/workers-page-availability.test.ts after checkpoint; preserve its typed helper correction when S3 recovers that test. Do not merge task/R3.F1 wholesale, because its branch starts from baseline and physical HUB dirty content is not its commit.
- R1.3 exact manifest/order/remote procedure approval remains owner-only. Do not close it from this documentation task. All implementation groups need their own bounded card; R1.4 is the next missing detailed implementation card after R1.3.

## Source import dependencies

These are checkpoint module references between final owner groups, including imports already present in baseline. They are review prompts, not proof that every referenced module change must land first. New imports to checkpoint-added paths and feature-specific exports require hunk/dependency review.

| Dependent group → prerequisite group | Observed checkpoint import examples |
| --- | --- |
| S3 → S6 | `src/app/(app)/(workspace)/workers/page.tsx imports src/components/worker-forms.tsx`<br>`src/app/(app)/(workspace)/workers/page.tsx imports src/server/db/workers.ts`<br>`src/server/db/calculations.ts imports src/core/engine/index.ts` (and 4 more) |
| S3 → S8 | `src/app/(app)/(workspace)/workers/page.tsx imports src/components/table-view.tsx`<br>`src/server/db/table-views.ts imports src/core/views/index.ts`<br>`src/server/db/table-workspace.ts imports src/core/views/index.ts` |
| S4 → S3 | `src/app/(app)/(workspace)/dashboard/page.tsx imports src/server/db/views.ts`<br>`src/app/(app)/(workspace)/dashboard/page.tsx imports src/server/db/table-views.ts`<br>`src/app/(app)/(workspace)/runs/[runId]/page.tsx imports src/server/db/table-views.ts` (and 6 more) |
| S4 → S5 | `src/components/payroll-review-panel.tsx imports src/components/evidence-pack-download.tsx`<br>`src/components/payroll-review-panel.tsx imports src/components/review-correction-panel.tsx` |
| S4 → S6 | `src/app/(app)/(workspace)/runs/[runId]/page.tsx imports src/components/worker-forms.tsx`<br>`src/app/(app)/(workspace)/runs/[runId]/page.tsx imports src/server/db/workers.ts`<br>`src/app/(app)/(workspace)/runs/[runId]/page.tsx imports src/server/db/calculate.ts` (and 3 more) |
| S4 → S8 | `src/app/(app)/(workspace)/dashboard/page.tsx imports src/components/table-view.tsx`<br>`src/app/(app)/(workspace)/runs/[runId]/page.tsx imports src/components/table-view.tsx`<br>`src/components/historical-threshold-panel.tsx imports src/lib/api.ts` (and 2 more) |
| S5 → S3 | `src/server/db/evidence-pack.ts imports src/server/db/calculations.ts`<br>`src/server/db/review-corrections.ts imports src/server/db/calculations.ts` |
| S5 → S4 | `src/core/workflow/corrections.ts imports src/core/workflow/review.ts`<br>`src/core/workflow/evidence-pack.ts imports src/core/workflow/review.ts`<br>`src/server/db/evidence-pack.ts imports src/core/workflow/review.ts` (and 2 more) |
| S5 → S6 | `src/core/workflow/evidence-pack.ts imports src/core/engine/index.ts`<br>`src/core/workflow/evidence-pack.ts imports src/core/engine/effective-compensation.ts` |
| S5 → S8 | `src/components/review-correction-panel.tsx imports src/lib/api.ts` |
| S6 → S3 | `src/server/db/calculate.ts imports src/server/db/audit.ts`<br>`src/server/db/calculate.ts imports src/server/db/calculations.ts`<br>`src/server/db/reconciliation.ts imports src/server/db/audit.ts` (and 1 more) |
| S6 → S5 | `src/server/db/calculate.ts imports src/core/workflow/evidence-pack.ts` |
| S6 → S8 | `src/components/effective-compensation-form.tsx imports src/lib/api.ts`<br>`src/components/effective-compensation-preview.tsx imports src/lib/api.ts`<br>`src/components/worker-forms.tsx imports src/lib/api.ts` |
| S7 → S2 | `src/app/admin/page.tsx imports src/server/auth/admin.ts`<br>`src/app/admin/support/page.tsx imports src/server/auth/admin.ts`<br>`src/server/db/platform-accounts.ts imports src/server/auth/admin.ts` |
| S7 → S3 | `src/app/admin/page.tsx imports src/server/db/settlement.ts` |
| S7 → S8 | `src/app/(app)/(workspace)/support/page.tsx imports src/components/review-help.tsx`<br>`src/components/support-panel.tsx imports src/lib/api.ts` |
| S9 → S2 | `src/app/admin/billing/page.tsx imports src/server/auth/admin.ts` |
| S9 → S8 | `src/components/billing-collection-panel.tsx imports src/lib/api.ts` |

## Shared files and hunk boundaries

| Final owner/path | Later feature dependencies / recovery instruction |
| --- | --- |
| S4 `src/app/(app)/(workspace)/runs/[runId]/page.tsx` | `src/components/table-view.tsx (S8)`<br>`src/server/db/table-views.ts (S3)`<br>`src/server/db/views.ts (S3)`<br>`src/components/worker-forms.tsx (S6)`<br>`src/server/db/workers.ts (S6)`<br>`src/server/db/calculate.ts (S6)` |
| S4 `src/app/(app)/(workspace)/dashboard/page.tsx` | `src/components/table-view.tsx (S8)`<br>`src/server/db/views.ts (S3)`<br>`src/server/db/table-views.ts (S3)` |
| S3 `src/app/(app)/(workspace)/workers/page.tsx` | `src/components/table-view.tsx (S8)`<br>`src/components/worker-forms.tsx (S6)`<br>`src/server/db/workers.ts (S6)` |
| S8 `src/components/table-view.tsx` | Inspect privacy/completeness versus feature diff hunks before copying; final file stays with its listed owner. |
| S6 `src/server/db/workers.ts` | `src/server/db/audit.ts (S3)` |
| S6 `src/server/db/calculate.ts` | `src/server/db/audit.ts (S3)`<br>`src/server/db/calculations.ts (S3)`<br>`src/core/workflow/evidence-pack.ts (S5)` |
| S3 `src/server/db/calculations.ts` | `src/core/engine/index.ts (S6)` |
| S3 `src/server/db/views.ts` | `src/core/reconciliation/index.ts (S6)` |
| S3 `src/server/db/table-views.ts` | `src/core/reconciliation/index.ts (S6)`<br>`src/core/views/index.ts (S8)`<br>`src/server/db/reconciliation.ts (S6)`<br>`src/server/db/workers.ts (S6)` |
| S3 `src/server/db/table-workspace.ts` | `src/core/views/index.ts (S8)` |
| S8 `src/lib/api.ts` | Inspect privacy/completeness versus feature diff hunks before copying; final file stays with its listed owner. |
| S7 `src/components/shell/nav-config.ts` | Inspect privacy/completeness versus feature diff hunks before copying; final file stays with its listed owner. |
| S4 `tests/unit/workspace-experience.test.ts` | Inspect privacy/completeness versus feature diff hunks before copying; final file stays with its listed owner. |
| S4 `tests/unit/run-page-experience.test.ts` | Inspect privacy/completeness versus feature diff hunks before copying; final file stays with its listed owner. |

Concrete diff review: run git diff --unified=3 0eebda5 58555a9 -- <exact path>. S3 owns financial-role checks/read failure/exact-count guards. S6 owns effective_compensations lookup/captured segment calculation. S8 owns named selector/request application and API status support. S4 owns review/task/history rendering. For tests that verify several features, recover assertions with their matching hunks or combine slices; never weaken protected tests. package.json/lockfile/ci.yml are S1-only; nav-config is S7-only; architecture/security updates remain S10 with unchanged runtime authority.

## All new migrations, in application order

SQL dependencies confirmed in source: billing foundations defines a trigger on payroll_review_events (S4 must exist before S9); Stripe lifecycle references billing_company_events (billing foundations first); corrections references review/calculation records; collection follows billing foundations/lifecycle. Financial-read-role SQL must be executed on a disposable baseline/final stack before claiming independence. Source inspection is not successful migration evidence.

| Migration | Owner | Ordering note |
| --- | --- | --- |
| `supabase/migrations/20261007000001_review_workflow.sql` | S4 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |
| `supabase/migrations/20261007000002_review_readiness.sql` | S4 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |
| `supabase/migrations/20261007000003_platform_accounts.sql` | S7 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |
| `supabase/migrations/20261007000004_support.sql` | S7 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |
| `supabase/migrations/20261007000005_review_tasks.sql` | S4 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |
| `supabase/migrations/20261007000006_historical_thresholds.sql` | S4 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |
| `supabase/migrations/20261007000007_named_views.sql` | S8 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |
| `supabase/migrations/20261008000001_billing_foundations.sql` | S9 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |
| `supabase/migrations/20261008000002_review_corrections.sql` | S5 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |
| `supabase/migrations/20261008000003_effective_compensation.sql` | S6 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |
| `supabase/migrations/20261008000004_stripe_test_lifecycle.sql` | S9 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |
| `supabase/migrations/20261008000005_financial_read_roles.sql` | S3 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |
| `supabase/migrations/20261008000006_treasury_read_roles.sql` | S3 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |
| `supabase/migrations/20261008000007_stripe_test_collection.sql` | S9 | Apply sorted after baseline migrations; verify on disposable stack in R1.6/R2. |

## Exact checkpoint path ownership

| Change | Path | Owner/exclusion |
| --- | --- | --- |
| A | `.antigravityignore` | EXCLUDED-TOOLING |
| M | `.env.example` | S10 |
| M | `.github/workflows/ci.yml` | S1 |
| M | `AGENT.md` | S10 |
| M | `ARCHITECTURE-ESSENTIALS.md` | S10 |
| M | `ARCHITECTURE.md` | S10 |
| M | `CLAUDE.md` | S10 |
| M | `DESIGN.md` | S10 |
| M | `FILE-STRUCTURE.md` | S10 |
| M | `PRD.md` | S10 |
| M | `PROGRESS.md` | S10 |
| A | `docs/deep-research-report.md` | EXCLUDED-RESEARCH |
| M | `docs/integrations/README.md` | S10 |
| A | `docs/memory/2026-10-08-progress-before.md` | S10 |
| M | `docs/memory/project.md` | S10 |
| A | `docs/mockups/_template.html` | S10 |
| A | `docs/mockups/account.html` | S10 |
| A | `docs/mockups/assets/kleeno.css` | S10 |
| A | `docs/mockups/dashboard.html` | S10 |
| A | `docs/mockups/help.html` | S10 |
| A | `docs/mockups/index.html` | S10 |
| A | `docs/mockups/invite.html` | S10 |
| A | `docs/mockups/login.html` | S10 |
| A | `docs/mockups/onboarding.html` | S10 |
| A | `docs/mockups/payroll-activity.html` | S10 |
| A | `docs/mockups/payroll-calculation.html` | S10 |
| A | `docs/mockups/payroll-import.html` | S10 |
| A | `docs/mockups/payroll-payments.html` | S10 |
| A | `docs/mockups/payroll-review.html` | S10 |
| A | `docs/mockups/payroll-table.html` | S10 |
| A | `docs/mockups/payroll-workflow.html` | S10 |
| A | `docs/mockups/receipt.html` | S10 |
| A | `docs/mockups/settings-billing.html` | S10 |
| A | `docs/mockups/settings-company.html` | S10 |
| A | `docs/mockups/settings-library.html` | S10 |
| A | `docs/mockups/settings-policy.html` | S10 |
| A | `docs/mockups/settings-team.html` | S10 |
| A | `docs/mockups/worker-profile-w008.html` | S10 |
| A | `docs/mockups/worker-profile.html` | S10 |
| A | `docs/mockups/workers.html` | S10 |
| A | `docs/my-new-plan-1.md` | EXCLUDED-RESEARCH |
| A | `docs/my-new-plan-2.md` | EXCLUDED-RESEARCH |
| M | `docs/p4-database-acceptance.md` | S10 |
| M | `docs/pages.md` | S10 |
| A | `docs/phases/LOCAL-commercial-review.md` | S10 |
| M | `docs/phases/STEP1-verification.md` | S10 |
| A | `docs/plans/2026-10-07-commercial-gap-review.md` | S10 |
| A | `docs/plans/2026-10-07-evidence-pack.md` | S10 |
| A | `docs/plans/2026-10-07-historical-thresholds.md` | S10 |
| A | `docs/plans/2026-10-07-local-completion.md` | S10 |
| A | `docs/plans/2026-10-07-named-views-experience.md` | S10 |
| A | `docs/plans/2026-10-07-named-views.md` | S10 |
| A | `docs/plans/2026-10-07-review-tasks.md` | S10 |
| A | `docs/plans/2026-10-07-support.md` | S10 |
| A | `docs/plans/2026-10-07-workflow-view.md` | S10 |
| A | `docs/plans/2026-10-08-billing.md` | S10 |
| A | `docs/plans/2026-10-08-branch-safety.md` | S10 |
| A | `docs/plans/2026-10-08-corrections.md` | S10 |
| A | `docs/plans/2026-10-08-effective-changes.md` | S10 |
| A | `docs/plans/2026-10-08-financial-privacy.md` | S10 |
| A | `docs/plans/2026-10-08-isolated-ci.md` | S10 |
| A | `docs/plans/2026-10-08-next-security-patch.md` | S10 |
| A | `docs/plans/2026-10-08-offline-font-build.md` | S10 |
| A | `docs/plans/2026-10-08-verification-status.md` | S10 |
| A | `docs/plans/2026-10-09-continuation-handoff.md` | S10 |
| A | `docs/plans/local-delivery-ledger.md` | S10 |
| M | `docs/roadmap.md` | S10 |
| M | `docs/security.md` | S10 |
| M | `package-lock.json` | S1 |
| M | `package.json` | S1 |
| A | `reference-prompt.md` | S10 |
| M | `src/app/(app)/(workspace)/dashboard/page.tsx` | S4 |
| M | `src/app/(app)/(workspace)/runs/[runId]/page.tsx` | S4 |
| A | `src/app/(app)/(workspace)/runs/[runId]/workflow/page.tsx` | S4 |
| A | `src/app/(app)/(workspace)/settings/billing/page.tsx` | S9 |
| M | `src/app/(app)/(workspace)/settings/company/page.tsx` | S4 |
| M | `src/app/(app)/(workspace)/settlement/page.tsx` | S3 |
| A | `src/app/(app)/(workspace)/support/page.tsx` | S7 |
| M | `src/app/(app)/(workspace)/workers/page.tsx` | S3 |
| A | `src/app/admin/billing/page.tsx` | S9 |
| M | `src/app/admin/page.tsx` | S7 |
| A | `src/app/admin/support/page.tsx` | S7 |
| A | `src/app/api/admin/accounts/route.ts` | S7 |
| A | `src/app/api/admin/billing/route.ts` | S9 |
| A | `src/app/api/admin/support/[id]/route.ts` | S7 |
| A | `src/app/api/admin/support/route.ts` | S7 |
| A | `src/app/api/billing/checkout/route.ts` | S9 |
| A | `src/app/api/billing/collect/route.ts` | S9 |
| A | `src/app/api/billing/commands/reconcile/route.ts` | S9 |
| A | `src/app/api/billing/reconcile/route.ts` | S9 |
| A | `src/app/api/billing/route.ts` | S9 |
| A | `src/app/api/billing/usage/route.ts` | S9 |
| A | `src/app/api/runs/[id]/corrections/route.ts` | S5 |
| A | `src/app/api/runs/[id]/evidence/route.ts` | S5 |
| A | `src/app/api/runs/[id]/readiness/route.ts` | S4 |
| A | `src/app/api/runs/[id]/review/route.ts` | S4 |
| A | `src/app/api/runs/[id]/tasks/route.ts` | S4 |
| A | `src/app/api/runs/[id]/thresholds/route.ts` | S4 |
| A | `src/app/api/stripe/webhook/route.ts` | S9 |
| A | `src/app/api/support/[id]/route.ts` | S7 |
| A | `src/app/api/support/route.ts` | S7 |
| A | `src/app/api/tables/[table]/named-views/[id]/route.ts` | S8 |
| A | `src/app/api/tables/[table]/named-views/route.ts` | S8 |
| A | `src/app/api/workers/[id]/effective-compensation/preview/route.ts` | S6 |
| A | `src/app/api/workers/[id]/effective-compensation/route.ts` | S6 |
| A | `src/app/fonts/OFL.txt` | S1 |
| A | `src/app/fonts/README.md` | S1 |
| A | `src/app/fonts/SofiaSans-Variable.ttf` | S1 |
| M | `src/app/layout.tsx` | S1 |
| A | `src/components/billing-admin-panel.tsx` | S9 |
| A | `src/components/billing-collection-panel.tsx` | S9 |
| A | `src/components/billing-provider-refresh.tsx` | S9 |
| A | `src/components/effective-compensation-form.tsx` | S6 |
| A | `src/components/effective-compensation-preview.tsx` | S6 |
| A | `src/components/evidence-pack-download.tsx` | S5 |
| A | `src/components/historical-threshold-panel.tsx` | S4 |
| A | `src/components/named-view-selector.tsx` | S8 |
| A | `src/components/payroll-review-panel.tsx` | S4 |
| A | `src/components/review-correction-panel.tsx` | S5 |
| A | `src/components/review-help.tsx` | S8 |
| A | `src/components/review-task-panel.tsx` | S4 |
| A | `src/components/run-workflow-view.tsx` | S4 |
| M | `src/components/shell/app-sidebar.tsx` | S7 |
| M | `src/components/shell/nav-config.ts` | S7 |
| M | `src/components/shell/search-palette.tsx` | S7 |
| A | `src/components/support-panel.tsx` | S7 |
| M | `src/components/table-view.tsx` | S8 |
| M | `src/components/worker-forms.tsx` | S6 |
| A | `src/core/billing-collection.ts` | S9 |
| A | `src/core/billing.ts` | S9 |
| A | `src/core/engine/effective-compensation-schema.ts` | S6 |
| A | `src/core/engine/effective-compensation.ts` | S6 |
| M | `src/core/engine/index.ts` | S6 |
| A | `src/core/growth/accounts.ts` | S7 |
| A | `src/core/named-views.ts` | S8 |
| M | `src/core/reconciliation/index.ts` | S6 |
| A | `src/core/support.ts` | S7 |
| A | `src/core/variance/anomalies.ts` | S4 |
| A | `src/core/variance/history.ts` | S4 |
| A | `src/core/variance/threshold-settings.ts` | S4 |
| M | `src/core/views/index.ts` | S8 |
| A | `src/core/workers/effective-compensation.ts` | S6 |
| A | `src/core/workflow/corrections.ts` | S5 |
| A | `src/core/workflow/evidence-pack.ts` | S5 |
| A | `src/core/workflow/readiness.ts` | S4 |
| A | `src/core/workflow/review-settings.ts` | S4 |
| A | `src/core/workflow/review-tasks.ts` | S4 |
| A | `src/core/workflow/review.ts` | S4 |
| M | `src/lib/api.ts` | S8 |
| M | `src/server/auth/admin.ts` | S2 |
| M | `src/server/db/audit.ts` | S3 |
| A | `src/server/db/billing-collection.ts` | S9 |
| A | `src/server/db/billing-provider.ts` | S9 |
| A | `src/server/db/billing.ts` | S9 |
| M | `src/server/db/calculate.ts` | S6 |
| M | `src/server/db/calculations.ts` | S3 |
| A | `src/server/db/effective-compensation-preview.ts` | S6 |
| A | `src/server/db/effective-compensation.ts` | S6 |
| A | `src/server/db/evidence-pack.ts` | S5 |
| A | `src/server/db/historical-thresholds.ts` | S4 |
| A | `src/server/db/named-views.ts` | S8 |
| A | `src/server/db/payroll-review.ts` | S4 |
| A | `src/server/db/platform-accounts.ts` | S7 |
| M | `src/server/db/reconciliation.ts` | S6 |
| A | `src/server/db/review-corrections.ts` | S5 |
| A | `src/server/db/review-readiness.ts` | S4 |
| A | `src/server/db/review-tasks.ts` | S4 |
| A | `src/server/db/reviewer-summary.ts` | S4 |
| A | `src/server/db/reviewer-workspace.ts` | S4 |
| M | `src/server/db/settlement.ts` | S3 |
| A | `src/server/db/support.ts` | S7 |
| M | `src/server/db/table-views.ts` | S3 |
| M | `src/server/db/table-workspace.ts` | S3 |
| M | `src/server/db/views.ts` | S3 |
| M | `src/server/db/workers.ts` | S6 |
| A | `src/server/stripe-billing.ts` | S9 |
| A | `supabase/migrations/20261007000001_review_workflow.sql` | S4 |
| A | `supabase/migrations/20261007000002_review_readiness.sql` | S4 |
| A | `supabase/migrations/20261007000003_platform_accounts.sql` | S7 |
| A | `supabase/migrations/20261007000004_support.sql` | S7 |
| A | `supabase/migrations/20261007000005_review_tasks.sql` | S4 |
| A | `supabase/migrations/20261007000006_historical_thresholds.sql` | S4 |
| A | `supabase/migrations/20261007000007_named_views.sql` | S8 |
| A | `supabase/migrations/20261008000001_billing_foundations.sql` | S9 |
| A | `supabase/migrations/20261008000002_review_corrections.sql` | S5 |
| A | `supabase/migrations/20261008000003_effective_compensation.sql` | S6 |
| A | `supabase/migrations/20261008000004_stripe_test_lifecycle.sql` | S9 |
| A | `supabase/migrations/20261008000005_financial_read_roles.sql` | S3 |
| A | `supabase/migrations/20261008000006_treasury_read_roles.sql` | S3 |
| A | `supabase/migrations/20261008000007_stripe_test_collection.sql` | S9 |
| M | `tests/db/ai-cache.test.ts` | S2 |
| A | `tests/db/billing-collection.test.ts` | S9 |
| A | `tests/db/billing-provider.test.ts` | S9 |
| A | `tests/db/billing.test.ts` | S9 |
| A | `tests/db/effective-compensation.test.ts` | S6 |
| A | `tests/db/financial-read-roles.test.ts` | S3 |
| A | `tests/db/historical-thresholds.test.ts` | S4 |
| A | `tests/db/named-views.test.ts` | S8 |
| A | `tests/db/payroll-review.test.ts` | S4 |
| A | `tests/db/platform-accounts.test.ts` | S7 |
| A | `tests/db/review-corrections.test.ts` | S5 |
| A | `tests/db/review-tasks.test.ts` | S4 |
| A | `tests/db/support.test.ts` | S7 |
| A | `tests/invariants/ai/document-injection.test.ts` | S2 |
| M | `tests/invariants/security/app-structure.test.ts` | S4 |
| A | `tests/invariants/security/local-name-unlock.test.ts` | S2 |
| A | `tests/unit/admin-assurance.test.ts` | S2 |
| A | `tests/unit/admin-inventory-experience.test.ts` | S7 |
| A | `tests/unit/api-support-denial.test.ts` | S7 |
| A | `tests/unit/billing-api.test.ts` | S9 |
| A | `tests/unit/billing-collection-api.test.ts` | S9 |
| A | `tests/unit/billing-collection-panel.test.ts` | S9 |
| A | `tests/unit/billing-collection-repository.test.ts` | S9 |
| A | `tests/unit/billing-collection.test.ts` | S9 |
| A | `tests/unit/billing-pages.test.ts` | S9 |
| A | `tests/unit/billing-provider.test.ts` | S9 |
| A | `tests/unit/billing-repository.test.ts` | S9 |
| A | `tests/unit/billing.test.ts` | S9 |
| A | `tests/unit/calculation-lines.test.ts` | S3 |
| A | `tests/unit/dashboard-review-experience.test.ts` | S4 |
| A | `tests/unit/database-target.test.ts` | S1 |
| A | `tests/unit/effective-compensation-capture.test.ts` | S6 |
| A | `tests/unit/effective-compensation-engine.test.ts` | S6 |
| A | `tests/unit/effective-compensation-form.test.ts` | S6 |
| A | `tests/unit/effective-compensation-legacy.test.ts` | S6 |
| A | `tests/unit/effective-compensation-preview-form.test.ts` | S6 |
| A | `tests/unit/effective-compensation-preview.test.ts` | S6 |
| A | `tests/unit/effective-compensation-reconciliation.test.ts` | S6 |
| A | `tests/unit/effective-compensation-recovery.test.ts` | S6 |
| A | `tests/unit/effective-compensation-repository.test.ts` | S6 |
| A | `tests/unit/effective-compensation-timeline.test.ts` | S6 |
| A | `tests/unit/evidence-pack-download-actions.test.ts` | S5 |
| A | `tests/unit/evidence-pack-download.test.ts` | S5 |
| A | `tests/unit/evidence-pack-repository.test.ts` | S5 |
| A | `tests/unit/evidence-pack-route.test.ts` | S5 |
| A | `tests/unit/evidence-pack.test.ts` | S5 |
| A | `tests/unit/historical-anomalies.test.ts` | S4 |
| A | `tests/unit/historical-threshold.browser.ts` | S4 |
| A | `tests/unit/historical-thresholds.test.ts` | S4 |
| A | `tests/unit/history.test.ts` | S4 |
| A | `tests/unit/named-views.browser.ts` | S8 |
| A | `tests/unit/named-views.test.ts` | S8 |
| A | `tests/unit/payroll-evidence-completeness.test.ts` | S3 |
| A | `tests/unit/payroll-review.browser.ts` | S4 |
| A | `tests/unit/payroll-review.test.ts` | S4 |
| A | `tests/unit/platform-accounts-repository.test.ts` | S7 |
| A | `tests/unit/platform-accounts.test.ts` | S7 |
| A | `tests/unit/readiness.test.ts` | S4 |
| A | `tests/unit/review-corrections-panel-evidence.test.ts` | S5 |
| A | `tests/unit/review-corrections-panel.test.ts` | S5 |
| A | `tests/unit/review-corrections-repository.test.ts` | S5 |
| A | `tests/unit/review-corrections-route.test.ts` | S5 |
| A | `tests/unit/review-corrections.test.ts` | S5 |
| A | `tests/unit/review-help.test.ts` | S8 |
| A | `tests/unit/review-readiness.test.ts` | S4 |
| A | `tests/unit/review-repository.test.ts` | S4 |
| A | `tests/unit/review-task.browser.ts` | S4 |
| A | `tests/unit/review-tasks-repository.test.ts` | S4 |
| A | `tests/unit/review-tasks.test.ts` | S4 |
| A | `tests/unit/reviewer-summary.test.ts` | S4 |
| A | `tests/unit/reviewer-workspace.test.ts` | S4 |
| M | `tests/unit/run-page-experience.test.ts` | S4 |
| M | `tests/unit/run-trace.test.ts` | S6 |
| A | `tests/unit/run-workflow-experience.test.ts` | S4 |
| A | `tests/unit/run-workflow.browser.ts` | S4 |
| A | `tests/unit/settlement-page-privacy.test.ts` | S3 |
| A | `tests/unit/settlement-read-privacy.test.ts` | S3 |
| A | `tests/unit/stripe-billing.test.ts` | S9 |
| A | `tests/unit/support-page-experience.test.ts` | S7 |
| A | `tests/unit/support.browser.ts` | S7 |
| A | `tests/unit/support.test.ts` | S7 |
| A | `tests/unit/table-privacy.test.ts` | S3 |
| A | `tests/unit/worker-page-privacy.test.ts` | S3 |
| A | `tests/unit/workers-page-availability.test.ts` | S3 |
| M | `tests/unit/workspace-experience.test.ts` | S4 |
| M | `vitest.db.config.ts` | S1 |

## Physical HUB delta after checkpoint

**35 paths** differ or are new at this capture, separate from the 276-path recovery set. Compare physical files, not HEAD alone: checkpoint-added files are currently untracked in HUB and still present. Live coordination may change after capture; recapture before R1.15. R1.2 manifest itself is created after this snapshot and belongs S10 as the R1.2 integration deliverable.

| Kind | Path | Disposition |
| --- | --- | --- |
| new after checkpoint | `.claude/agents/progress.md` | excluded local agent tooling |
| modified after checkpoint | `AGENT.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| modified after checkpoint | `AGENTS.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| modified after checkpoint | `CLAUDE.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| modified after checkpoint | `PROGRESS.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| new after checkpoint | `docs/agent-workflow.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| new after checkpoint | `docs/archive/roadmap-2026-10-07.md` | D18 archival copy; recover with approved link updates |
| modified after checkpoint | `docs/github.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| new after checkpoint | `docs/marketing.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| new after checkpoint | `docs/memory/2026-10-10-progress-before.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| modified after checkpoint | `docs/memory/build-history.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| modified after checkpoint | `docs/memory/project.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| new after checkpoint | `docs/phases/R0-branch-audit.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| new after checkpoint | `docs/phases/R0.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| new after checkpoint | `docs/phases/R1.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| new after checkpoint | `docs/phases/R3.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| new after checkpoint | `docs/phases/UI-completion.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| new after checkpoint | `docs/plans/2026-10-10-connection-diagnostic.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| new after checkpoint | `docs/plans/2026-10-10-ui-completion-review.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| new after checkpoint | `docs/progress/R0.1.md` | HUB-only live coordination snapshot |
| new after checkpoint | `docs/progress/R0.2.md` | HUB-only live coordination snapshot |
| new after checkpoint | `docs/progress/R0.3.md` | HUB-only live coordination snapshot |
| new after checkpoint | `docs/progress/R0.4.md` | HUB-only live coordination snapshot |
| new after checkpoint | `docs/progress/R0.5.md` | HUB-only live coordination snapshot |
| new after checkpoint | `docs/progress/R1.1.md` | HUB-only live coordination snapshot |
| new after checkpoint | `docs/progress/R1.2.md` | HUB-only live coordination snapshot |
| new after checkpoint | `docs/progress/R3.F1.md` | HUB-only live coordination snapshot |
| new after checkpoint | `docs/progress/RD.1.md` | HUB-only live coordination snapshot |
| new after checkpoint | `docs/progress/UI.A.md` | HUB-only live coordination snapshot |
| new after checkpoint | `docs/progress/UI.B.md` | HUB-only live coordination snapshot |
| new after checkpoint | `docs/progress/_README.md` | HUB-only live coordination snapshot |
| new after checkpoint | `docs/progress/_migrations.md` | HUB-only live coordination snapshot |
| modified after checkpoint | `docs/roadmap.md` | post-checkpoint coordination/documentation; latest HUB overlay |
| new after checkpoint | `scripts/progress.mjs` | post-checkpoint coordination/documentation; latest HUB overlay |
| modified after checkpoint | `tests/unit/workers-page-availability.test.ts` | post-checkpoint application; preserve R3.F1 overlay |

## Acceptance evidence

- Inventory uniqueness and source coverage checked with generated exact path sets; counts are computed from git metadata. No artificial red baseline or application/DB passing claim.
- Local links resolve from physical HUB (workflow/Git/card). Integration may not contain earlier coordination references until S10; that bootstrap distinction is explicit.
- Task commit contains only R1 card and this manifest, with staged Gitleaks scan. No excluded checkpoint path is staged.
- Post-checkpoint source protection: this task writes documentation only. Reference counts and overlays must be revalidated before recovery.
