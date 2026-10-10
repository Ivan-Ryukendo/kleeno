# R1.3 — Review the recovery direction and first implementation slice

Status: prepared for owner approval, 2026-10-10. No implementation, remote action or owner approval is implied.

## Why this is next

The five website improvements are locally verified, while the clean integration tree contains recovery documentation only. Tooling recovery is the next build prerequisite. The configured database responds but lacks selected worker fields and metadata views; testing the existing migrations on a disposable database must precede any proposed cloud repair.

## Concrete decision

Approve the [recovery manifest](../plans/2026-10-10-recovery-manifest.md) as the ownership inventory: 276 checkpoint paths, 272 assigned to ten groups and four excluded paths. Preserve excluded research/tooling locally, checkpoint, archive tag and backups. Approve S1 tooling first, then S2's actual incremental delta rather than duplicating Step-1 code already in main. Later dependency-coupled groups require bounded cards and explicit hunk boundaries before implementation; approving this direction does not approve copying all shared files or all later cards.

Approve the [R1.4 tooling card](R1-tooling.md) for its exact nine paths: CI workflow, package/lockfile, three font files, root layout, database-target unit tests and disposable DB test configuration. Current integration is fd44f530d25612eb39bca3890a4bc2ea497cd36a; source checkpoint is 58555a9bed4d634e0f22f00f9e0bf97f17fbf416. Preserve the separately reviewed R3.F1 and nineteen UI overlay paths documented in the [website review](../plans/2026-10-10-website-review.md); recapture overlays before later recovery.

Approve this private CI procedure for the reviewed recovery slices:

1. Re-verify Ivan-Ryukendo/kleeno is private and inspect the remote integration ref. Stop on unexpected divergence; never force-push.
2. Publish the reviewed integration/2026-10 base when needed, then the independently reviewed task branch. D1 already allows reviewed private task branches; this decision adds the explicit integration-base and PR destination procedure.
3. Create a draft PR targeting integration/2026-10 so the existing pull_request trigger runs. Link every PR to the T3 thread. No PR to main, remote merge or deployment.
4. Require the actual head and tested merge SHA in evidence. Use synthetic credentials and a disposable CI database, never the configured remote development/production database or provider credentials. Revalidate if the base changes.
5. After applicable checks pass, merge locally under the lock with --no-ff. Publish subsequent reviewed integration updates only through this procedure. Do not merge the draft PR remotely.

Alternative: approve only local R1.4 recovery/checks; leave it at review with disposable DB/CI acceptance pending. This alternative does not authorize integration pushes or PRs.

## Acceptance and limitations

Before code: record the owner's exact choice in project memory and progress. Record R1.3 done only if the manifest direction, first slice and chosen execution procedure are approved. Later cards remain separate approvals. Correct R2.1's dependency before claiming all-migration acceptance; its current R1.7-only prerequisite is insufficient.

R1.4 requires fail-first target tests, full unit/type/lint/build, font/browser smoke, staged secret scan, independent review and disposable DB acceptance before completion. S1 has no feature migrations: a passing S1 DB job cannot verify the fourteen later migrations. No authenticated browser, provider, deployed or production-readiness claim follows from this decision.

## Preparation evidence and rollback

Two independent GPT-6.1 medium read-only assessments recommend tooling/CI as the immediate critical path. CI has main-only push and unfiltered pull_request triggers, so a feature push alone does not run CI. The other next website candidate is worker-specific search navigation, which needs a scoped backend contract and its own card; it is not implemented here.

Preparation owns this card only; HUB coordination owns R1.3 progress, ledger, memory and generated board. Local links, staged secret scan and whitespace checks are required. Rollback reverts only this documentation commit; preserve every source file/ref, existing UI worktree and backup. No source, schema, security rule or protected test is modified.
