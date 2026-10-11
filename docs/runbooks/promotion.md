# Promotion: test -> dev -> prod

R5.3, owner-authorized staging decision dated 2026-10-11. This is an executable procedure for an authorized operator, **not evidence that a migration, backup, restore or deployment has occurred**. Agents may run isolated test checks; owner performs production access, configuration, deployment and provider steps. Never merge draft PR #13 or merge into `main` as part of agent execution.

## 1. Freeze the candidate and target

1. Record the exact integration commit, previous compatible release/deployment, sorted migration filenames and their SHA-256 hashes, operator and target **name**. Use one reviewed commit through all stages; a source change restarts test validation. Resolve all required risk reviews and the relevant wave gate. PR #13 supplies CI evidence only.
2. Test means loopback/disposable CI or pinned `kleeno-test` (`axcgcjpmcdujxkvroqox`); persistent hosted fixtures use unique IDs. Dev means `kleeno-dev`, synthetic staging, in a separate Vercel project with its own Production-scope values. Prod means the owner's production target. Never copy production data or credentials to test, dev or Preview. See [inventory and rotation](../security.md#2-secrets-and-keys).
3. Owner verifies project identity in the Supabase dashboard and verifies the linked project identifier before every remote CLI session. Do not select a target by reading production-prefixed env values. No credentials in CLI arguments, shell history, logs or screenshots; use private prompts/provider login. An unknown target stops the procedure.
4. Keep SIMULATION as the default, live payments OFF and branch Preview deployments disabled. The waitlist remains the public homepage; the app is accessed by direct link. No repository link is added to the site. Promotion never enables provider credentials, wallets, funds movement or live payments.

## 2. Test the exact candidate

From the clean candidate worktree, using only generated synthetic env values/mocks and loopback/disposable database values:

```powershell
$env:TEMP = 'E:/Ivan/Public/Copitation/Hackathon/ARC Canteen 2026/Project/Kleeno/.tools/tmp'
$env:TMP = $env:TEMP
$env:npm_config_cache = 'E:/Ivan/Public/Copitation/Hackathon/ARC Canteen 2026/Project/Kleeno/.npm-cache'
npm ci --cache 'E:/Ivan/Public/Copitation/Hackathon/ARC Canteen 2026/Project/Kleeno/.npm-cache'
npm run lint
npm run typecheck
npm test
npm run test:invariants
npm run test:db
npm run build
npm run test:e2e
```

Check each exit code; stop at any failure. Fresh disposable CI must apply every migration in order and demonstrate the current schema/history before DB/browser checks. Never reset a persistent hosted test project or run production/dev fixtures. If contracts changed, also run `forge build` and `forge test` from `contracts/`. Run the staged/full-history redacted secret scans required by [git policy](../github.md). Record actual head/environment/counts and links to CI results; local unit success alone is not a DB or browser pass. G3's owner-authorized Circle checks R3.8/R3.11 remain explicitly deferred, not passed.

## 3. Back up and apply one migration at a time

**Dev:** migration changes are authorized only after backup. **Prod:** owner only, after R5.4 restore/decryption evidence, R5.5 rollback rehearsal and the production migration gate. Do not activate prod while those prerequisites are missing.

1. Owner inspects remote migration history and compares it with the candidate's immutable files. Stop on an unknown/missing historical version or drift; do not use `migration repair` to conceal discrepancies or edit an applied file.
2. Before **each** pending migration, take a new target-specific recovery point, record its time/identifier and verify it completed and is usable. Include schema/data, immutable snapshots/audit, migration history and required Auth/storage recovery coverage. Securely escrow encryption-key versions needed by that recovery point. A plain schema dump or untested backup is not restore proof; R5.4 restores into scratch and verifies decryption. Keep backup contents/keys outside Git and CI artifacts.
3. Use pinned Supabase CLI `2.120.0` with a separate staging directory under HUB `.tools/tmp`. Copy `supabase/config.toml` and the candidate's migration **prefix through the single next migration** into its `supabase/` layout, excluding later pending files. The prefix must contain every already-applied version unchanged. This avoids the default `db push` behavior of applying all pending migrations after only one backup.
4. Owner assigns `$stageDir` to that absolute staging directory and `$targetRef` to the privately verified project's identifier. Authenticate privately, then run:

```powershell
npx supabase@2.120.0 --workdir $stageDir link --project-ref $targetRef
npx supabase@2.120.0 --workdir $stageDir migration list --linked
npx supabase@2.120.0 --workdir $stageDir db push --linked --dry-run
```

The dry-run must list **exactly one** pending file, matching the next candidate migration. If zero, verify it was already applied; if more than one or history differs, stop and correct the staging prefix. Check the backup is complete for this exact target and boundary, then owner applies:

```powershell
npx supabase@2.120.0 --workdir $stageDir db push --linked
npx supabase@2.120.0 --workdir $stageDir migration list --linked
```

5. Compare resulting remote history with the staged prefix and verify that migration's expected schema/RLS/grants without reading payroll values. Record metadata-only outcome. Extend the prefix by one file, take a **new** backup and repeat. Never pass `--include-seed`, reset the remote DB or import test fixtures into production.
6. Any apply failure stops promotion. Preserve the recovery point and observed history/error (redacted), determine partial effects, and write a new reviewed additive forward-fix migration. Do not blindly replay an uncertain change, drop snapshots/audit or roll back by editing old migration files.

CLI flags and migration-history behavior: [official Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags), [migration workflow](https://supabase.com/docs/guides/deployment/database-migrations). CLI availability depends on operator prerequisites; no CLI/network step was executed to prepare this runbook. Windows has no `psql`; use the existing Node `pg` tooling or owner dashboard for required metadata checks, without printing connection strings.

## 4. Stage, smoke, then owner promotion

1. After all dev migrations match the candidate, owner deploys the exact commit to the separate staging Vercel project with dev-only environment values. Do not flip the public waitlist to app mode. Check login/role denial, tenant isolation, MFA/re-auth denial and concurrent stale-edit handling. Exercise SIMULATION import/calculation; approval, obligation creation and payment attempts must be rejected. Check read-only receipt access separately against existing authorized evidence. Verify the kill switch remains OFF and no real Circle/Stripe/Google call is made.
2. Record staging deployment/commit and redacted smoke outcomes. Any failure returns to test; a repair is a new commit tested through the same chain. No production promotion from a locally modified worktree.
3. Owner checks plans/backup support and restore evidence, records a production recovery point before each production migration using section 3, and then deploys that same reviewed commit to the intended app project. No plan purchase, public visibility change, main merge or deployment is performed by an agent. Vercel Pro is required before commercial pilots; owner checks current plan terms.
4. Production smoke uses authorized metadata/synthetic demo records only, with no funds/provider activation. Verify public waitlist and direct app link, auth/RLS boundaries, required migration history, OFF state and redacted logs. Record actual results; never describe a pending owner step as passed.

## 5. Rollback and forward fix

- Stop new writes and leave live payments OFF. Owner rolls the application back to the previously recorded **schema-compatible** deployment; test that compatibility on staging before promotion. Old code may not understand a new schema, engine/hash format or key version: if incompatible, forward-fix the application rather than selecting it blindly.
- Schema rollback is a new reviewed additive migration, with backup before application and full isolated regressions. Preserve approved configurations, calculations, obligations, snapshots and append-only audit; never undo historical hashes or financial evidence.
- Restore a recovery point first into isolated scratch, with its escrowed encryption-key versions; validate decryption, history, tenant controls and post-backup events. Restoring a database does not undo external Circle/Arc/Stripe activity. Owner reconciles external events before any separately approved recovery to the real target; UNKNOWN attempts retain original identities/keys and cannot be replayed blindly.
- Record candidate/previous commit, deployment IDs, migration hashes/history, backup IDs, checks, operator/time, failure and resolution in the task's progress/release evidence. R5.5 must exercise both app rollback and schema forward fix on backed-up dev before production readiness is claimed.

### R5.5 owner rehearsal (not yet executed)

1. Privately identify the synthetic `kleeno-dev` app project, database project and current deployment. Record their non-secret IDs, the reviewed candidate commit and a previous **verified compatible** deployment. Keep writes paused and payments OFF throughout the rehearsal. No compatible previous deployment or recoverable backup means blocked, not passed.
2. Before each migration, complete section 3's target verification and backup/restore check. Record the recovery point and escrowed key versions without exposing keys. Restore only into isolated scratch and prove encrypted synthetic records, immutable snapshots, tenant access and audit history remain readable; never reset dev or restore over it for this drill.
3. Deploy the reviewed candidate to dev as owner. Capture a synthetic calculation and its version metadata/hash plus the current migration history. Verify a normal SIMULATION journey and denied payment initiation. Application rollback must retain the v1 engine/hash reader and the atomic compensation/exception fixes; an older incompatible or unsafe build is not an acceptable rollback target.
4. Owner selects the recorded compatible deployment in the dev hosting project, then verifies the same captured calculation replays with the same hash, existing API contracts work, tenant checks and immutable history hold, and payments remain OFF. Record deployment IDs and actual results. If these checks fail, restore the candidate application deployment and keep the task blocked; do not strip snapshot versions or alter historical evidence.
5. Rehearse a reviewed additive forward fix against the backed-up dev schema using section 3's one-migration procedure. Choose an actual reviewed correction and first prove it on disposable DB CI; do not fabricate an undo migration or alter an applied file merely to complete the drill. Verify migration history, the captured calculation/hash and existing audit events after application. Without a reviewed forward fix and backup evidence, this part remains pending.
6. Return dev to the reviewed candidate, verify its deployment/schema pair, resume only synthetic non-payment writes, and record operator/time, backup/restore evidence, both deployment IDs, migration hash, smoke results and any failure in `docs/progress/R5.5.md`. Mark done only after both rollback and forward-fix checks actually pass. No production deployment, provider activation or funds movement is part of this drill.

## 6. Release notes and owner tagging (R5.6)

The offline generator requires Node 22.18+ and local Git objects. Assign `$candidateCommit` and `$previousReleaseCommit` to the explicit reviewed candidate and its previous release (or the initial baseline for the first release), then run from the repository root:

```powershell
node scripts/release-notes.ts --ref $candidateCommit --previous $previousReleaseCommit
if ($LASTEXITCODE -ne 0) { throw 'Release note generation failed; do not release.' }
```

It resolves refs to immutable commit IDs, requires the previous commit to be an ancestor, hashes sorted migration files from committed bytes and rejects changed/removed historical migrations. Dirty files are excluded. Its output is a **candidate**, not release acceptance: it reads no application env, fetches no objects, and creates no file, tag, release or deployment.

Owner adds the release scope, actual gate/CI results for that exact commit, test/dev migration history, backup and rollback/forward-fix evidence, deferred Circle checks, deployment IDs and relevant production prerequisites from this runbook. Confirm current Vercel plan suitability and record purchase/activation evidence separately; this task neither purchases Pro nor claims it is configured. Commercial pilots remain gated on Pro and the other launch requirements.

After required evidence and target approvals, owner chooses the unused `v0.x` release name, creates an annotated tag **at the exact verified candidate commit**, verifies the tag resolves to it and explicitly authorizes publication. Never move/reuse an existing release tag, tag a dirty workingtree as if verified, merge draft PR #13 or deploy through this generator. Record the real tag and migration list before marking R5.6 done; until then its progress state remains `code done, gate and owner release pending`.

## 7. R11.1 owner-only Stripe TEST acceptance (pending)

Offline fake-adapter Checkout lifecycle tests do not create a real subscription or authorize provider activation. This is a separately approved owner step after R3.9 TEST setup; keep R11.1 open until actual acceptance. R3.7 Circle/Arc credentials and funded payroll acceptance remain separate and are not supplied by a billing subscription.

1. Owner privately confirms approved test company/database, reviewed schema/application commit and configured HTTPS site origin. Configure only `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET` and explicit `STRIPE_TEST_API_VERSION` in the authorized server environment; no credentials in chat, commands or screenshots. Live payments remain OFF. No production/live Stripe key.
2. Assign explicit billable TEST company terms, record current base price, then sign in as the current company Owner and use `/settings/billing` Checkout with the reviewed price and own password. The server records one command key and pinned intent before the Stripe write; retain that existing command ID/key on uncertainty.
3. Owner completes the resulting Stripe TEST Checkout using the provider's test payment method in its hosted page. Record public TEST session/customer/subscription IDs and command ID only, never payment details or secrets. Do not create a second Checkout when the outcome is unknown.
4. In the same company use explicit billing reconciliation (`POST /api/billing/reconcile`, no body). Verify current server-bound Checkout, customer, subscription and invoice objects agree; record observed TEST status/revision. Receipt hints alone do not grant entitlement or payment authority; entitlement remains UNCONFIGURED pending D12.
5. After a lost write response, inspect the existing command and use explicit command reconciliation (`POST /api/billing/commands/reconcile` with `commandId` and exact TEST `objectId`); this only reads and commits bound provider facts. Never blindly retry a write or replace the key. Record failure/unresolved states honestly and keep the ledger open.
