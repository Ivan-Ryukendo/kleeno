# Runbook: Circle wallets on ARC-TESTNET (provision and fund)

Task R3.6. Audience: the owner. Result: the approver and agent wallets and the PayrollGuard exist for the demo company, and the approver holds testnet USDC, ready for the R3.7 LIVE_TESTNET run.

Rules for this runbook:
- **OWNER** marks a step only you can do (Circle console, secrets, faucet, `.env`). Everything else is copy-paste.
- Secret values live only in `.env` (never committed, never pasted in chat, issues, logs or screenshots). This file names variables, never values.
- Testnet only. The Circle API key must start with `TEST_API_KEY:`; the app refuses anything else (`src/server/circle/client.ts`). Mode stays `SIMULATION` until R3.7.
- Never run this against `kleeno-prod`. Step 1 makes you check which database `.env` points at, because the scripts write wallet rows to it.
- Run from the repo root. Commands are POSIX shell (Git Bash); in PowerShell use the same `npm run script -- ...` lines.

For the full owner sequence through funded payroll and Circle/Stripe delivery acceptance, see the [setup checklist](promotion.md#8-start-here-when-provider-setup-is-still-pending-r37--r39). No provider setup or funded acceptance is claimed by these instructions.

## What gets created

| Thing | Where | Role |
|---|---|---|
| Wallet set `kleeno-<first 8 chars of company id>` | Circle | Groups the two wallets |
| APPROVER wallet (EOA, ARC-TESTNET) | Circle + `company_wallets` row | Treasury; owns the guard; holds the USDC |
| AGENT wallet (EOA, ARC-TESTNET) | Circle + `company_wallets` row | Guard operator; pays obligations |
| PayrollGuard contract | Arc testnet + `companies.guard_address` | Pays only committed obligations |

No private key exists in the repo: Circle holds the keys and your entity secret authorises it.

## 0. Prerequisites

1. **OWNER** Circle developer account, console **Testnet toggle on**.
2. **OWNER** `.env` in the repo root (copy `.env.example` if missing). Variables used here: `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `ARC_RPC_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. `npm ci` done. Use a terminal whose history is private.

## 1. Check the target database (read-only)

The scripts use `SUPABASE_URL` from `.env` and write to `company_wallets` and `companies`. Print only the host:

```bash
grep '^SUPABASE_URL=' .env | sed 's#^[^=]*=##; s#^https\?://##; s#[/].*##'
```

It must be the dev (or a disposable) project, not the host in `SUPABASE_PROD_URL`. The scripts act on the synthetic dev company "Pilot Co" (`COMPANY_ID` in `scripts/_lib.ts`), which must exist in that database. **OWNER** decides; if unsure, stop.

## 2. OWNER: create the Circle TEST API key

1. Circle console (Testnet on) > API Keys > create a key allowed to use Developer Controlled Wallets and Smart Contract Platform.
2. Put it straight into `.env` as `CIRCLE_API_KEY=` (starts with `TEST_API_KEY:`). Nowhere else.

## 3. OWNER: generate and register the entity secret

The entity secret is 32 random bytes as 64 hex characters, held only by you. Kleeno never registers it for you (rule 31).

1. Generate it locally and write it directly into `.env` as `CIRCLE_ENTITY_SECRET=`. Do not print it into a shared or logged terminal.
2. Register its ciphertext with Circle (console entity-secret setup, or Circle's SDK registration helper; follow Circle's current developer-controlled wallets instructions). Circle returns a **recovery file**.
3. Store the recovery file **outside the repo** (password manager or encrypted drive). It is the only way to reset the entity secret; if lost, these wallets cannot be recovered.
4. Confirm `.env` is ignored by git: `git check-ignore .env` must print `.env`.

## 4. Check the environment (names only, no Circle call)

```bash
grep -E '^(CIRCLE_API_KEY|CIRCLE_ENTITY_SECRET|ARC_RPC_URL)=.+' .env | cut -d= -f1
```

All three names must be listed (a missing one is not set). `ARC_RPC_URL` is `https://rpc.testnet.arc.network` (`.env.example`). The code enforces: key prefix `TEST_API_KEY:`, entity secret exactly 64 hex characters.

## 5. Provision the wallets

```bash
npm run script -- scripts/setup-wallets.ts
```

`scripts/setup-wallets.ts` calls `provisionWallets` (`src/server/circle/provisioning.ts`): creates the wallet set and two ARC-TESTNET EOA wallets with Circle idempotency keys derived from the company id, then stores one APPROVER and one AGENT row in `company_wallets`. Safe to re-run: if both rows exist nothing is created and the same addresses print.

Expected output: `APPROVER (treasury, guard owner): 0x...` and `AGENT (guard operator): 0x...`. Addresses are public. Copy both for step 6.

On failure the message names invalid variables, never values. Fix `.env` and re-run. After 3 failed attempts on the same error, stop and write the error and two options into `docs/progress/R3.6.md`.

## 6. OWNER: fund from the testnet faucet

1. Open https://faucet.circle.com, network **Arc Testnet**, token **USDC**.
2. Request funds for the **APPROVER** address, then for the **AGENT** address (small amount, for gas).
3. On Arc, USDC is also the gas token. The approver needs the batch total plus gas; keep the demo run at or below 100 USDC (P4 acceptance). The faucet limits requests per address; request early and repeat if short.

## 7. Verify balances (read-only: Arc RPC and database)

```bash
npm run script -- scripts/check-balances.ts
```

Prints per wallet `USDC <amount>` (ERC-20, 6 dp) and `native <amount>` (gas, 18 dp) after asserting the RPC is the Arc testnet chain. Expect APPROVER USDC at least the batch total and AGENT native above zero. If short, wait a minute and re-run, then use the faucet again.

## 8. Deploy the PayrollGuard

```bash
npm run script -- scripts/deploy-guard.ts
```

Deploys the guard from the approver wallet through Circle (owner = approver, operator = agent, USDC address fixed in code) and stores `companies.guard_address`. Idempotent: does nothing once the address is stored. Expected: `PayrollGuard: 0x... https://testnet.arcscan.app/address/0x...`. Open the link and confirm the contract exists. Deployment can take minutes; if it says no contract address yet, run the same command again (it resumes).

## 9. Hand over to R3.7 (do not switch live on here)

Live payments stay **off**. R3.7 (OWNER) turns them on and runs a LIVE_TESTNET payroll with two different human approvers (payroll approver and a different payment approver); the database refuses `on` unless both exist. For reference only:

```bash
npm run script -- scripts/live-payments.ts on     # R3.7 only
npm run script -- scripts/live-payments.ts off    # kill switch; add --close-open-runs to return unpaid funds
```

Record for R3.7 evidence: the two wallet addresses, the guard address, the Arcscan receipt link, and the step 7 output before and after. Addresses and hashes are public; keys and secrets are never recorded.

## Known gaps (do not improvise around them)

- These CLI scripts act on one fixed company, synthetic dev "Pilot Co". The existing admin live-payments approval route can provision an approved non-demo/non-sandbox company through `provisionCompany`; this runbook does not operate that route or provision another target. Demo/sandbox companies cannot activate live payments.
- Testnet only: the `TEST_API_KEY:` check and `ARC-TESTNET` are hard-coded. Production wallets are out of scope.
- Faucet amounts and limits are set by Circle and change; follow what the faucet page shows.
- This runbook was written from the code and docs only. No wallet was created and no Circle call was made while writing it; the reviewer should confirm the commands against a first real run (R3.7 prep).

## If a secret is exposed

If `CIRCLE_API_KEY` or `CIRCLE_ENTITY_SECRET` is pasted in chat, a log or a commit, treat it as leaked: delete the API key in the Circle console and create a new one; reset the entity secret with the recovery file; update `.env`; tell the agent only that it happened, never the value.

## Checklist

- [ ] Step 1 target database confirmed not prod
- [ ] Steps 2-3 key and entity secret in `.env`; recovery file stored outside the repo
- [ ] Step 5 wallets created (two addresses recorded)
- [ ] Step 6 both wallets funded; step 7 balances verified
- [ ] Step 8 guard deployed (Arcscan link recorded)
- [ ] Live payments still off, ready for R3.7
