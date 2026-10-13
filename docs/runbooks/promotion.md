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

1. Privately identify the synthetic `kleeno-dev` app project, database project and current deployment. Record their non-secret IDs, the reviewed candidate commit and a previous **verified compatible** deployment. Pause normal application writes; permit only the reviewed synthetic SIMULATION writes and owner migration steps named below. Keep payments OFF throughout the rehearsal. No compatible previous deployment or recoverable backup means blocked, not passed.
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
2. Assign explicit billable TEST company terms, record current base price, then sign in as the current company Owner on `/settings/billing`, choose **Create TEST Checkout**, enter your password, click **Create reviewed TEST Checkout**, then **Open Stripe TEST Checkout**. Verify the reviewed base price first. The server records one command key and pinned intent before the Stripe write; retain that existing command ID/key on uncertainty.
3. Owner completes the resulting Stripe TEST Checkout using the provider's test payment method in its hosted page. Record public TEST session/customer/subscription IDs and command ID only, never payment details or secrets. Do not create a second Checkout when the outcome is unknown.
4. In the same company use explicit billing reconciliation (`POST /api/billing/reconcile`, no body). Verify current server-bound Checkout, customer, subscription and invoice objects agree; record observed TEST status/revision. Receipt hints alone do not grant entitlement or payment authority; entitlement remains UNCONFIGURED pending D12.
5. After a lost write response, inspect the existing command and use explicit command reconciliation (`POST /api/billing/commands/reconcile` with `commandId` and exact TEST `objectId`); this only reads and commits bound provider facts. Never blindly retry a write or replace the key. Record failure/unresolved states honestly and keep the ledger open.

## 8. Start here when provider setup is still pending (R3.7 / R3.9)

Provider setup was reported **not done** by the owner on 2026-10-13. These are instructions for later owner execution, not completed acceptance. Choose one reviewed app commit and one synthetic, non-demo, non-sandbox company in the approved test/dev environment. Record its company ID and HTTPS origin before starting; stop if either is uncertain. Confirm schema promotion separately using sections 1-4. No production provider account, real worker data or real payment method belongs in this exercise.

| Order | Owner action | Completion evidence |
|---|---|---|
| 1 | Finish [Circle TEST wallets, entity-secret registration, faucet funding and guard](circle-wallets.md) (R3.6); keep live OFF | Correct company, public wallet/guard addresses, Arc chain 5042002 and funded test balances |
| 2 | Follow [funded payroll](live-testnet-payroll.md) with distinct human payroll and payment approvers (R3.7), then review its repeat procedure (R10.1) | Independently matched Arc receipt, exact hashes/key/amount/recipient, A/B approval records and audited OFF |
| 3 | Configure Stripe TEST server values and webhook below (R3.9); billing tests keep payroll live OFF | Non-secret account/mode, origin, pinned API version and endpoint ID; values stored privately |
| 4 | Complete section 7 Checkout (R11.1), then sections 9-11 delivery, usage and cancellation/failure checks | Bound TEST objects and observed results, without claiming entitlements or payroll authority |

Circle scripts act only on Pilot Co `00000000-0000-4000-8000-000000000002`; the app acts on the signed-in company. They must match if used together. Circle requires `TEST_API_KEY:` and a 64-hex entity secret. Stripe requires `sk_test_`, matching endpoint `whsec_` and explicit `STRIPE_TEST_API_VERSION`; privately select a version compatible with the reviewed serializers, never invent or silently upgrade it. Keep secrets only in ignored owner env or the authorized server environment, not chat, shell arguments, evidence or screenshots. Never copy another worktree's env.

For Stripe assignment, a current platform admin uses the existing admin **Billing and demos** page: enter company ID, **Load company billing**, select/create the reviewed tier or custom USD-cent price, enable **Explicitly enable commercial usage preview for this company**, enter a reason and **Assign explicit price**. Demo/sandbox companies are excluded. Company Owner then checks Monthly terms on `/settings/billing`; assignment is not a subscription or payment approval. See [admin source](../../src/components/billing-admin-panel.tsx).

### Circle webhook registration and genuine delivery (R10.2)

Owner registers `https://<approved-origin>/api/circle/webhook` for the same Circle TEST account. The [official subscription API](https://developers.circle.com/api-reference/wallets/common/create-subscription) is `POST https://api.circle.com/v2/notifications/subscriptions`, with private Bearer authentication, JSON `endpoint` equal to that URL and `notificationTypes: ["transactions.*"]`. Use the provider's private console/API client; no credential-bearing curl command is recorded here. Confirm the resulting subscription ID, endpoint and enabled state.

Kleeno verifies the raw body with `X-Circle-Signature` and `X-Circle-Key-Id`, fetching the matching public key; no extra webhook secret is configured. A signed ping can return success while doing no payment work. Complete genuine transaction delivery against an existing bound attempt, record notification/transaction IDs and response, then verify one settlement/financial effect after provider retries or a controlled replay of the same genuine signed bytes. Do not manufacture a signature, change the body or submit another payment for this check. Multiple handler invocations are allowed; multiple financial effects are not. If the console offers no resend, record that limitation and leave the live replay evidence pending rather than claiming success.

The handler processes only `transactions.*` hints and re-queries Circle/Arc. Unknown transaction IDs prove no settlement. See [handler](../../src/app/api/circle/webhook/route.ts), [signature verifier](../../src/server/circle/webhook.ts) and [executor](../../src/server/payments/execute.ts). Registration and a ping alone do not close R10.2.

### Stripe webhook setup (R3.9)

In the chosen Stripe TEST environment, use Workbench **Webhooks** to create a destination for **Your account**, **Snapshot** payloads, the reviewed API version and `https://<approved-origin>/api/stripe/webhook`. This handler expects snapshot `data.object`; Thin or Connect events are unsupported. Privately save that destination's signing secret as `STRIPE_TEST_WEBHOOK_SECRET` for the same server and account. Follow [Stripe's registration instructions](https://docs.stripe.com/webhooks).

Select only these implemented types: `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.finalized`, `invoice.voided`, `invoice.marked_uncollectible`. Source: [TEST parser/config](../../src/server/stripe-billing.ts), [public handler](../../src/app/api/stripe/webhook/route.ts). If an event fails schema validation, record the actual response and stop for a reviewed compatibility fix; do not relax verification.

## 9. Stripe signed delivery, replay and reordering (R11.2)

After Checkout is bound and section 7 reconciliation succeeds, inspect the destination's delivery record for a genuine supported TEST event belonging to that exact customer/subscription. Record event ID, object ID, HTTP outcome and pending reconciliation. Use Stripe Dashboard **Resend** on that event, then resend two existing events for the same subscription with the newer event delivered before the older one. Stripe provides resend and does not promise ordering: [delivery behavior](https://docs.stripe.com/webhooks#event-delivery-behaviors). Do not edit payloads or reuse a captured expired signature.

Refresh the billing page after deliveries: signed hints may mark reconciliation PENDING, but they do not overwrite provider observations or grant entitlements. Click **Refresh Stripe TEST status** (existing `POST /api/billing/reconcile`, no body), then compare current bound Checkout/customer/subscription/latest invoice with the provider dashboard and record observation time/revision. Older hints must not restore an old subscription state; duplicate event IDs must not create another receipt or charge. Current facts can remain pending if a new event races reconciliation; refresh again only after inspecting that result. Source: [refresh control](../../src/components/billing-provider-refresh.tsx), [reconciliation](../../src/server/db/billing-provider.ts).

## 10. Closed UTC-month usage invoice (R11.3)

Usage comes from immutable human commercial-review SIGNOFF events while usage preview was explicitly enabled. It counts each company/worker once per UTC calendar month and pins that worker's original assignment price. Payroll approval/payment is a separate flow; changing a run period does not backdate the signoff month. Do not edit timestamps or insert meter rows to invent acceptance. If no closed month with actual synthetic signoffs exists, nonzero live invoice acceptance stays pending until that month closes; zero-only evidence cannot prove a nonzero invoice. See [meter trigger](../../supabase/migrations/20261008000001_billing_foundations.sql).

On `/settings/billing`, choose **Invoice a closed UTC month**, enter the month, click **Review usage quote**, and record the displayed unique workers, cents and returned source hash. The server's quote route is `GET /api/billing/usage?month=YYYY-MM-01`; current/future UTC months are refused. Enter your own password and select **Create reviewed TEST usage invoice**. If a **Prepared commands** entry appears, continue that same entry with fresh password confirmation for the remaining observed stages; never create another charge key.

The existing collection command freezes `month`, `expectedAmountCents`, `expectedSourceHash` and UUID `idempotencyKey`; the app sends it with `password` to `POST /api/billing/collect`. Compare recorded invoice ID, customer/subscription binding, command metadata, USD total and its single usage line against the quote. Zero remains NO_CHARGE, with no invoice write. DONE means the provider request was observed, not that collection succeeded. A source/hash change or **Unreconciled late usage** stops continuation; do not replace the charge to hide a mismatch. See [UI](../../src/components/billing-collection-panel.tsx), [collection schema](../../src/core/billing-collection.ts) and [service](../../src/server/db/billing-collection.ts).

On UNKNOWN/IN_FLIGHT, use **Reconcile an uncertain request**: select the existing command, enter its exact TEST provider object ID from Stripe, then **Read and reconcile provider evidence**. This GET-based recovery verifies binding; any remaining write requires a separate password-confirmed continuation of that frozen command. Never infer success from a lost response.

## 11. Cancellation, failed collection and evidence (R11.4)

After usage acceptance, select **Cancel at period end**, enter your password and click **Confirm period-end cancellation**. This existing action requests `cancel_at_period_end=true` with no proration on the server-bound subscription. Record the command and refresh current Stripe TEST status; scheduled cancellation can coexist with active status until the provider period ends. Do not label it canceled early.

For failed collection, use a separate bound synthetic TEST subscription if the previous cancellation prevents renewal. Follow [Stripe's failed-payment testing](https://docs.stripe.com/testing#declined-payments) for a test-only declining payment method and an actual test invoice attempt. If using [test clocks](https://docs.stripe.com/billing/testing/test-clocks), first verify that the bound TEST customer is eligible; this Checkout does not attach a clock and a generic unrelated fixture proves no company binding. If no supported bound scenario exists, leave that acceptance pending. Never use real payment details.

Observe a genuine `invoice.payment_failed` delivery, explicitly refresh current subscription/latest-invoice facts, then complete the provider's test-only recovery on that same binding and refresh again. A failed-payment hint alone cannot prove `past_due`, `unpaid` or `canceled`: record what current objects actually report. Replay an older failure hint after recovery and verify it only requests reconciliation; it must not overwrite newer observations. Confirm calculation/review/worker/usage history remains available and payroll live stays OFF. Grace, taxes, refunds and entitlements remain UNCONFIGURED.

Retain one redacted evidence entry per task: reviewed app commit, environment/company/mode, operator/time, relevant command/event/object IDs, observed status and current-fact revision, exact quote or approval hashes, public Arc receipt where applicable, OFF state, failure/recovery and remaining blockers. No raw provider payloads, secrets, real names or payment details. Mark R3.7/R3.9/R10.1/R10.2/R11.1-R11.4 complete only after their actual evidence and required owner review exist; this guide executes none of them.
