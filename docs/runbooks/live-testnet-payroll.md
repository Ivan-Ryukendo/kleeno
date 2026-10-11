# Repeatable funded LIVE_TESTNET payroll (OWNER)

**Drafted, waits on R3.7.** Source-reviewed procedure; no funded run or provider interaction was performed while writing it. R3.7 must supply the first independently matched Arc receipt and two different human approvals before this becomes a reviewed repeat procedure. R10.1 stays open. Every live step below is OWNER-operated and requires explicit owner authorization; this document grants an agent no authority to execute it.

## Preconditions and stop conditions

Read [wallet provisioning and funding](circle-wallets.md), [architecture rules](../../ARCHITECTURE-ESSENTIALS.md) 17-31 and [security controls](../security.md) S05, S26-S30 and S66. Use synthetic records only, the approved test database/company, Circle TEST credentials and Arc testnet chain **5042002**. Never use production, demo/sandbox companies, a mainnet key, real payroll, or unreviewed recipient details. Keep secrets in ignored env files; no values in commands, screenshots, evidence or chat.

The CLI scripts are fixed to synthetic Pilot Co (`scripts/_lib.ts`: company ID `00000000-0000-4000-8000-000000000002`). Their package runner reads `.env` in the chosen checkout. The owner privately confirms the target host, company, migration state and credentials before any command. Do not copy another worktree's `.env` or infer the target from its branch. App requests use the signed-in company instead; confirm that company matches the CLI target before mixing them.

Choose a fresh synthetic period, one recipient and a small owner-approved budget within the existing 100-USDC demonstration cap. Record the exact six-decimal obligation amount and public recipient before signing. Two different current members must act: payroll approver A and payment approver B; both use their own authenticated MFA sessions. The Owner/admin role does not replace either approval. Use a manually signed batch, avoiding standing authorization for this demonstration.

Stop on wrong chain/company, missing funds/gas, stale calculation/plan, recipient change, unresolved exception, gate rejection or uncertain provider outcome. Never alter a DB row, role, amount, guard commitment, attempt key or protected test to get past a stop.

## Interim verification while R3.7 is unmet

Run locally with installed dependencies; these tests use fake ports and do not prove funded settlement:

```powershell
npm test -- tests/invariants/payments/payment-gate.test.ts tests/invariants/payments/payment-flow.test.ts tests/invariants/payments/payment-recovery.test.ts
```

Use SIMULATION for synthetic workflow rehearsal: it stops at CALCULATION_VALIDATED and cannot create payable obligations or settle. R3.8 forced timeout/crash/kill-switch drills remain SIMULATION/mocks until the owner completes R3.7. Disposable DB checks use the project's isolated target recipe only, never the remote `.env` target.

## OWNER preparation (external operations)

1. Complete the existing Circle runbook: the owner registers the entity secret, retains recovery material outside the repository, provisions APPROVER/AGENT wallets, funds both using the Arc testnet faucet, and deploys the guard. Do not re-register or deploy merely to repeat a payroll run. Verify the stored guard owner/operator and wallet roles before using them.
2. From the owner's correctly configured checkout, check current balances:

   ```powershell
   npm run script -- scripts/check-balances.ts
   ```

   This makes database/Arc reads. APPROVER needs the obligation total plus gas; AGENT needs gas. ERC-20 USDC uses 6 decimals, native gas uses 18. Faucet access and amounts remain owner decisions.
3. Confirm the company has completed live request, admin approval and provisioning. Owner switches ON through the authenticated company control with password reauthentication and fresh TOTP. The existing fixed-company CLI alternative is owner-only:

   ```powershell
   npm run script -- scripts/live-payments.ts on
   ```

   This writes the switch and audit; it is not a substitute for A/B approvals. Never run it on a company that has not satisfied S66.

## OWNER human approval and execution sequence

Use the existing app controls in the authenticated company; endpoint/body names below identify the existing commands, not a curl instruction containing credentials.

| Actor | Step | Existing server command and evidence |
|---|---|---|
| A | Create fresh LIVE_TESTNET run; enter synthetic inputs, reconcile and resolve exceptions, calculate and validate | `POST /api/runs` with `mode`, `periodStart`, `periodEnd`; preserve run ID, config version and calculation hash |
| A | Review exact calculation/recipient; approve with own password | `POST /api/runs/{runId}/approve` with `password`; approval binds hash and creates obligations |
| A | Resume missing obligations only if already approved | `POST /api/runs/{runId}/obligations`, no body; review existing run before resuming |
| B | Propose deterministic fallback batch and inspect exact obligation set | `POST /api/runs/{runId}/plan` with `holdIds: []`, `planner: false`; no AI or standing grant replaces B |
| B | Sign reviewed plan using own password | `POST /api/batches/{batchId}/sign` with `password`; record B distinct from A and bound plan hash |
| B | Resume opening already signed batch if needed | `POST /api/batches/{batchId}/open`, no body; owner wallet commits exact keys/recipients/amounts on guard |
| B | Execute existing signed batch | `POST /api/batches/{batchId}/execute`, no body; payment agent checks the gate for each obligation |

Sign/open can already have progressed the batch: inspect current state before repeating a command. Never create another run or batch to recover an uncertain payment. Execution may return remaining work after its time budget; continue the **same batch** only after inspecting its current state. For PAYING/UNKNOWN follow recovery below first.

`scripts/seed-run.ts` is not the human-approval path: it selects membership IDs and writes approvals/authorization from a service script, creates a fresh run on every invocation, and opens the guard. Do not run it to establish R3.7's two-human evidence or retry a failed run. `scripts/pay-obligation.ts <obligationId>` invokes the same gated agent but can submit; it remains owner-only, and does not create missing approval authority. Prefer the authenticated batch route for this procedure.

## Independent receipt acceptance

Record public run/batch/obligation IDs, calculation and plan hashes, A/B user IDs (no passwords), guard address, obligation key, exact amount/recipient/token, Circle transaction ID, Arc transaction hash and explorer link. Store no names, mapping files, secret material or raw provider errors.

Accept SETTLED only when Kleeno's independent Arc receipt matcher verifies chain 5042002, configured guard and USDC token, obligation key, recipient and amount. Circle COMPLETE or a successful HTTP response alone is insufficient. Compare the application record with the explorer receipt; a receipt missing from RPC remains uncertain, and mismatch is an explicit SETTLEMENT_MISMATCH. Capture before/after APPROVER and recipient balances with gas accounted for; treasury balance alone cannot prove a recipient payment. The current balance script reads APPROVER/AGENT, so recipient evidence requires the owner to inspect its public Arc address separately.

For repeatability, the owner records the first R3.7 evidence, then another fresh small run through the same human process and confirms one payment per committed obligation. Review by the owner is required before marking R10.1 done; a local test count cannot replace it.

## Recovery and kill switch (OWNER)

On timeout/crash/UNKNOWN, record existing IDs and disable new payments using the Owner/payment-approver OFF control. Fixed-company CLI:

```powershell
npm run script -- scripts/live-payments.ts off
```

OFF prevents new live authority/submissions, including recovery resubmission; it does not undo an already submitted transaction. Read-only recovery and independent settlement can continue. Owner or payment approver can request `POST /api/payments/recover` with no body in the same authenticated company; it is rate-limited. Recovery checks guard `isPaid` and Circle before acting. Preserve original obligations/attempts/idempotency keys. If paid, recover the receipt and settle without resending; if pending/unknown or RPC unavailable, retain uncertainty. A resubmission requires proven terminal failure, `isPaid=false`, and a fresh pass through the unchanged gate. Never manually resubmit a Circle transaction.

Returning unpaid guard funds is a separate owner-authorized chain operation:

```powershell
npm run script -- scripts/live-payments.ts off --close-open-runs
```

It closes eligible OPEN guard runs and returns unpaid funds to APPROVER; in-flight runs are skipped. Recover/check skipped runs before attempting closure again. Already paid funds are not rolled back. Leave live OFF after the run and record closure/skips, remaining uncertainty and next owner action. Do not delete rows or reset attempts as cleanup.

## Source and evidence checklist

- [ ] R3.7 completed by owner; two human approvers and independent receipt match recorded.
- [ ] Target/company/chain/TEST mode, funds/gas and owner authorization confirmed.
- [ ] Calculation/plan hashes, recipient, amount and separate A/B approvals preserved.
- [ ] Existing keys retained; one receipt matches each settled obligation.
- [ ] OFF audited; unpaid closure/skips and remaining funds reconciled.
- [ ] Owner reviewed repeat procedure; R10.1 ledger closure separately approved.

Implementation references: [script runner](../../package.json), [CLI company target](../../scripts/_lib.ts), [live switch](../../scripts/live-payments.ts), [payment agent/recovery](../../src/core/payments/agent.ts), [batch execution](../../src/server/payments/execute.ts), [batch authority](../../src/server/db/batches.ts), [settlement matcher](../../src/core/payments/settlement.ts). Webhook registration/real signed-delivery acceptance belongs to R10.2, not this draft; webhooks re-query authoritative providers and do not authorize payments.
