# P4 database acceptance handoff

Prepared October 6, 2026. Implementation is local; these migrations have not been applied. This document does not authorize cloud changes or payments.

## Ordered additive migrations

| File in `supabase/migrations/` | Change |
|---|---|
| `20261005000001_p4c_policy_workers_cache.sql` | Worker scope/employment evidence, configuration review/provenance and tenant-bound AI cache support |
| `20261005000002_p4c_run_adjustments.sql` | Reviewed pay adjustments and revision-bound calculation support |
| `20261005000003_p4_resource_columns.sql` | Encrypted resource definitions/input revisions, personal layouts and shared cell comments with tenant boundaries |
| `20261005000004_p4b_standing_limits.sql` | Exact standing-authorization amount ceiling; fails explicitly if existing grants exceed it |
| `20261006000001_atomic_config_activation.sql` | Service-only, role/tenant-bound atomic active-policy replacement and transition audit; invalid/concurrent targets never deactivate the current version |

Applied migration `20261004000005_p4_standing_authorization.sql` retains its existing contents. Do not rewrite migration history to deliver the new cap. All five additive migrations above must be applied before this build's config activation, seed and intake acceptance; the activation API now requires the atomic RPC.

## Execution boundary

Preferred execution is disposable local Supabase, matching the CI database job. This machine currently lacks Docker/psql; `.env` targets remote development. No new local-only seed or browser suite may run against that remote target.

If the owner approves development-project migration and DB acceptance instead, confirm the target is `kleeno-dev`, never production; verify a backup/recovery point and migration history before applying the five files in order. Database tests create synthetic companies/users and immutable evidence/audit rows. They use fake AI/Circle/Arc ports, not paid providers or actual transfers. Do not print secrets or run the separate live-payment/provider smoke commands.

Run `npm.cmd run test:db` after applying the ordered schema to the approved isolated/test target. Inspect failures without weakening protected tests. Focused new coverage includes policy/config/cache, run adjustments/calculation, resources/layouts/comments, seed repeatability, standing authorization and S33 trace. Seed and full browser tests remain localhost-only.

For disposable local Supabase, also run the production build and `npm.cmd run test:e2e`; Playwright discovery alone is not browser acceptance. The standalone table browser harness uses synthetic APIs and cannot replace tenant/RLS or stored-layout tests.

## Recovery and evidence

Do not drop approved snapshots, audit records or resource history to roll back application behavior. Restore the previous application build if necessary; investigate a failed migration before retrying. Any destructive schema/data restoration needs its own reviewed recovery procedure.

Record the exact target class, migration results, test counts/failures and remaining security rows in PROGRESS/project memory. Until this happens, DB immutability/RLS/re-authentication/concurrency and end-to-end trace acceptance remain unverified. Live Google, Circle/Arc settlement, Gateway/x402 and real searchable-policy storage are separate gates.
