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
