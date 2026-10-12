# Step 1 — Existing build verification and defect repair

Selected by the owner on October 7, 2026: finish Step 1 and repair confirmed defects before commercial features. Branch: `codex/p4-p5-completion`; baseline HEAD `ea44ab0`. Preserve existing documentation and source work.

## Scope and ownership

- Database worker: migration/DB acceptance and repository concurrency/isolation; owns confirmed fixes in DB repositories, migrations and DB tests.
- Browser worker: existing SIMULATION seed, Playwright and offline provider boundary; owns seed/e2e/config fixes. UI changes require DESIGN/pages and ui-ux-pro-max.
- Auth worker: existing password/Google/MFA/tenant authorization; owns auth source and focused unit regressions.
- Parent: read-only remote CI evidence, sequential local checks, integration and session records. Workers request ownership before touching another lane.

Each worker traces the actual flow, reports evidence gaps separately from defects, and tests its own repairs. Heavy local checks run sequentially by parent coordination. No remote development DB tests, real provider calls, cloud migrations, deployment, payment, publishing or merge.

## Acceptance and compatibility

Reuse current APIs/schema and five additive migrations in their recorded order. No speculative feature or new dependency. Confirmed defects require a failing regression then the smallest root-cause repair; protected tests stay intact. New migration only if a demonstrated schema defect requires it, with explicit recovery instructions; never edit applied migrations.

Record current branch/HEAD and remote job conclusions with URLs, fresh unit/invariant/type/lint/build evidence, and actual isolated DB/browser execution if available. Otherwise record target-specific blockers without claiming success. Auth provider and live settlement remain external evidence gates. F22 delivery inventory and applicable S33/S41/S61-S74 evidence are reviewed; F16-F23 commercial controls remain planned.

Finish with dated evidence/limitations in this document, project memory and PROGRESS (<=30 lines). Step 1 is not complete while required external/isolated acceptance remains blocked. No financial or SIMULATION boundary changes are permitted.

## October 7 evidence and repairs

Existing PR: https://github.com/Ivan-Ryukendo/kleeno/pull/12. Baseline isolated run: https://github.com/Ivan-Ryukendo/kleeno/actions/runs/37500469588 (`ea44ab017660ba0359ad6d216092256258addf23`). Contracts and secret jobs passed. Web lint/type/unit passed, but dependency audit failed for source-map-js GHSA-68fv-2mgg-jv7q. Database initialization/migrations succeeded; 263/264 tests passed, including trace, encryption, RLS and atomic activation. Standing acceptance failed; build/browser steps were skipped. This is historical isolated evidence, not acceptance of the repairs below.

- Shared payment fake supplied 1e18 micro-USDC, exceeding the planner's 16-digit input schema. Existing standing acceptance is the failing regression. An offline schema check failed with the original balance, then passed with 1e15; 16 existing planner tests passed. Only the fake changed, not money or standing guards.
- Demo seeding initialized server repositories before rejecting a remote target. New focused regression failed before the repair, then both seed boundary tests passed. The reused location guard now runs before imports; designated-demo and payments-off checks remain.
- Login/MFA/re-auth throttling treated an unreadable audit count as zero. Four failing regression cases became passing after the shared function reused the existing DB result guard; 32 focused auth/OAuth tests passed. Unknown count or query error now stops the action.
- Shared company/chooser authentication and MFA enrollment treated failed or missing assurance lookup as password-only access. Five failing regression cases became passing after inline fail-closed checks; combined auth/OAuth checks passed 39 tests across five files. Explicit valid aal1 behavior remains supported where allowed.
- Compatible source-map-js patch 1.2.2 changes only the lockfile; fresh production dependency audit reports zero vulnerabilities. CI now masks its generated disposable data/waitlist secrets before subsequent steps display environment variables.

Integration checks and repaired-head CI results are recorded after execution. Real Google/MFA provider round-trip, live Circle/Arc settlement, Gateway/x402 smoke, deployment/owner acceptance and restore/key evidence remain outside these local/fake-backed checks. Commercial F16-F23 are not marked verified.

Local integrated verification: 488 unit/invariant tests passed in 62 files; lint and typecheck passed; production build passed after the interrupted session was restarted; Playwright discovery found two workflows. Staged secret scan inspected 12 KB and found no leaks; whitespace check passed. The owner-selected isolated-CI path requires a corrective build-branch commit before DB/browser rerun; this is not phase closure or a release approval. Existing commercial-planning documentation remains local and preserved separately from the scoped repair commit.
