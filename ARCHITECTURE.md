# Kleeno — Architecture

Technical source of truth. `ARCHITECTURE-ESSENTIALS.md` wins on conflict.

## 1. Overview

Kleeno turns a company's pay policy into approved, deterministic payroll for its workers (employees and contractors) and settles it in USDC on Arc testnet, with every step validated, approved and audited.

```text
HR policy -> PolicyInterpreter (AI) -> validation + bounded repair -> HR approves config
CSV import (in-browser anonymise, mapping, dedupe, USD only) -> deterministic checks + ReconciliationAgent (AI)
  -> exceptions -> HR resolves -> engine (deterministic) -> trace + invariants
  -> HR approves payroll (binds calculation_hash) -> obligations
  -> PaymentPlanner (AI) proposes batch + holds + flags -> payment approver signs plan_hash
     (or a standing authorization signs a clean batch) -> openRun commits the batch on PayrollGuard
  -> gate -> payment agent -> Circle wallet -> PayrollGuard.pay -> USDC to worker
  -> settlement reconciliation (Arc receipt) -> held obligations released in a new signed batch -> audit trail

SIMULATION run: stops at CALCULATION_VALIDATED -> variance report. No payment path exists.
```

## 2. Decisions

| Decision |
|----------|
| Circle developer-controlled wallets (EOA, Arc testnet) + on-chain guard contract. Not Agent Wallets (their policies are mainnet-only). |
| Market: global by design, configured per company; first market (tentative) US firms paying remote contractors. Always say "Arc testnet USDC". |
| One company-managed wallet per worker; optional worker-supplied address. Custodial, stated openly. |
| `SIMULATION` (default, cannot pay) and `LIVE_TESTNET`. Payroll in USDC; imports in USD only, no FX in the MVP. |
| Build now; real pilot data is sourced in parallel and later. Synthetic data is never traction. |
| Next.js (TS) + Supabase + Circle Node SDK. The user is architect and product owner; agents write the code. Protected tests. |
| OpenRouter behind a provider-agnostic adapter; open models; privacy flags; $5 key cap; one fallback model. |
| Solidity guard via Foundry; `PaymentRail` interface, `ArcUsdcRail` only. |
| Demo-path scope only; thin end-to-end slice first; 6 phases P0–P5, P4b can be cut. |
| Payment Planner (AI) proposes order, batch vs hold, flags; the human signs the plan hash; deterministic code executes it (§14.7). |
| Standing authorization lets clean batches pay without a click; a human signs everything else (§14.8). |
| Pay types SALARIED, HOURLY, RETAINER; the term is "worker" (§6). |
| Integration-ready, not integration-heavy: capability-based evidence sources with provenance; the CSV upload is the first source; connectors, read-only MCP and journal export come after the hackathon (§24). |

Also fixed (user-approved 2026-09-29):
- Product = Kleeno; "Tameion" = hackathon only.
- The guard commits the exact obligation set of one batch at `openRun`; the agent can only `pay(obligationKey)` (§14.2).
- No scaling; a short balance fails closed (§5). Two roles, four-eyes in the DB, `company_id` + RLS (§12). Next.js at repo root, framework-free core, Vercel + Supabase cloud (§4, §21). Integer micro-USDC (§5).
- The per-payment ceiling and standing authorization are owned by the payment approver, not the HR config (§12). Judges use a SIMULATION-only demo company (§5, §19).
- Ponytail is a build-time, backend-only lean-code plugin, not part of the runtime (ESSENTIALS, Build).
- The whole UI follows `DESIGN.md` with the Kleeno adaptations in ESSENTIALS rule 45; theme tokens live once in `src/app/globals.css`.
- Defaults: AI statuses `ACCEPTED | REPAIRED | NEEDS_HUMAN_REVIEW`; max 2 repairs; 6-worker demo cast (PRD §7); no Gateway, Paymaster or CCTP.

## 3. Trust boundaries

| Layer | May | May never |
|-------|-----|-----------|
| AI (probabilistic) | interpret policy into catalog rules, classify discrepancies, propose exception resolutions, propose payment plans (order, hold, flag), explain traces, variances and plans | do final arithmetic, invent rules/rates/facts, change approved amounts, recipients or config, add obligations, approve or sign anything, move a run between states, initiate payment |
| Deterministic validation | schema, type/range/enum, semantic, referential, evidence, duplicate, idempotency, plan-completeness, state-machine checks | be bypassed; accept AI output that failed validation |
| Deterministic engine | all money arithmetic, calculation trace, payment signals | read AI numbers as authoritative |
| Humans | approve config, resolve exceptions, approve payroll, sign payment plans, release holds, set standing authorization | approve both payroll and payment for the same run |
| PayrollGuard contract | pay only committed obligations, each once, to the committed recipient and amount | hold names, IDs or payroll detail |
| External systems, MCP clients (§24) | supply evidence (normalized, with provenance); receive approved results; read through the read-only MCP | set rules, amounts, recipients or states; approve; create obligations; authorize or pay |

Execution and validation paths are separate modules. Validators never import AI code. No AI response both decides and certifies its own result.

## 4. Runtime and code layout

- `src/core/`: pure TypeScript domain; no I/O, framework or network. Reaches the outside only through ports (repositories, AI provider, payment rail, chain reader, clock, IDs).
- `src/server/`: adapters implementing the ports (Supabase repositories, OpenRouter, Circle wallets, Arc reader via viem, `ArcUsdcRail`, auth, redacting logger). `env.ts` validates the server env with Zod; everything here imports `server-only`.
- `src/app/`: App Router pages and thin route handlers: authenticate -> role from `app_users` -> load entities by ID inside the session's company (never trust company, role, amount or recipient from the request) -> core service -> compare-and-set persist -> audit event. Mutating handlers check `Origin`. Mutations only in `src/app/api` route handlers; no Server Actions. `src/proxy.ts` (Next 16's name for middleware) only refreshes the session and redirects; every handler and data-reading page authenticates on its own.
- Supabase access: the public API only reads. `authenticated` has SELECT under RLS (own company); `anon` has no table rights. Pages may read with the user-scoped client. Every write, from user handlers and system paths (webhook, payment agent, standing authorization, settlement, recovery, scripts) alike, goes through `src/server/db/` repositories on the service-role client. Those repositories take the company from the session or job entity and add `company_id` to every statement. DB triggers (four-eyes, append-only, immutability, kill switch) bind the service role too.
- `contracts/`: Foundry project with `PayrollGuard`.
- Hosting: Vercel + Supabase cloud (§21). No long-running workers: Circle webhook plus on-demand polling and recovery routes. The payment loop handles each obligation independently, so a function timeout leaves recoverable state (§14.6).

## 5. Run modes, currency, money

- `PayrollRun.mode` = `SIMULATION | LIVE_TESTNET`; set at creation, immutable, audited; default `SIMULATION`.
- SIMULATION runs end at `CALCULATION_VALIDATED`; obligation creation, planning, payment authorization and the agent reject them (fail closed). Kill switch `companies.live_payments_enabled`: when false (the demo company, or an emergency) it blocks LIVE_TESTNET run creation, plan signing, standing authorization, `openRun`, every gate check and recovery resubmission. A DB trigger also rejects batch authorization and new payment attempts. Read-only recovery and settlement continue. OFF: payment approver (UI, no re-auth) or script. ON: `scripts/live-payments.ts` only. Both audited.
- Payroll currency is USDC (1 USDC = 1 USD). Imports must be in USD; files or rows in another currency are rejected with a clear message. No FX in the MVP (roadmap).
- Money is integer micro-USDC (6 dp); rates and multipliers use a decimal library, never binary floats.
- Each line is rounded half-up to 0.01 USDC; gross = sum of lines; net = gross − deductions exactly.
- No scaling: the live payment always equals the approved amount; an insufficient balance fails closed. Large real payrolls run as SIMULATION.
- On-chain amounts use the ERC-20 USDC interface (6 dp); native 18-dp values are never used for payroll.

## 6. Payroll configuration

- Pay types (per worker): `SALARIED`, `HOURLY`, `RETAINER`.
- Rule catalog (MVP): `BASE_SALARY`, `HOURLY_RATE`, `FIXED_RETAINER`, `OVERTIME` (salaried: hours above the weekly threshold; hourly: approved hours above the contracted cap), `PAID_LEAVE`, `UNPAID_LEAVE`, `PERCENT_DEDUCTION` (tax, pension or other, as percentages of gross). Extensible in code only; AI cannot add types or formulas.
- Parameters: pay period, scheduled hours per period (salaried), weekly overtime threshold or contracted hours cap + multiplier (default 1.0 for hourly), leave treatment, deduction percentages, variance tolerance (default 0.01). Per-worker rate or retainer amount lives on the worker's compensation record. The per-payment ceiling is not config (§12).
- Policy text is stored as numbered clauses; every proposed rule cites the clause IDs it comes from.
- Rule IDs are versioned (e.g. `overtime_weekly_v2`); an approved version is immutable.
- Lifecycle: `DRAFT -> AI_PROPOSED -> VALIDATED -> HUMAN_REVIEW -> APPROVED -> ACTIVE -> SUPERSEDED | ARCHIVED`. HR approver approves; one ACTIVE version per company; every run references one exact version.
- Market presets (starting configs per country or worker type) are roadmap; every company configures its own rules today.

## 7. AI layer

Interfaces: `PolicyInterpreter`, `ReconciliationAgent`, `ExceptionExplainer`, `PayrollExplanationAgent`, `PaymentPlanner` (§14.7). One adapter calls OpenRouter; the model ID and one fallback model come from config.

```text
LLM -> parse -> schema (Zod) -> semantic -> evidence/reference
  valid   -> ACCEPTED (first try) or REPAIRED (after repair)
  invalid -> repair prompt with validation errors -> retry (max 2) -> validate again
  still invalid, both models down, or model returns NEEDS_HUMAN_REVIEW -> NEEDS_HUMAN_REVIEW exception
```

- Repair may only fix format when evidence supports it ("8.0" -> 8). Missing or guessed values -> `NEEDS_HUMAN_REVIEW`. Invalid output is never a best-effort answer.
- Semantic checks: known worker and rule IDs, non-negative hours/amounts, valid leave types, evidence IDs exist and belong to the same run and worker, no duplicate sources, no change to approved data. For config: each value appears in its cited clause and is within sanity bounds (e.g. multiplier 1–3, percentages 0–100); otherwise it is flagged for explicit HR confirmation.
- Inputs: every prompt input is built in `src/core/ai/inputs/` from strict Zod schemas (IDs, numbers, enums; the only free text is HR policy clauses). The adapter accepts only these typed inputs. No names, wallet addresses, notes or CSV cell text. Column-mapping suggestions see headers only.
- `AIExecution` stores: operation ID (e.g. `POLICY_INTERPRET`, `RECON_CLASSIFY`, `PAYMENT_PLAN`), trace ID, input reference, schema version, provider + model, prompt version, output, validation result, retry count, final status.
- Prompt contract: use only supplied evidence; invent no facts or policy; catalog rule IDs only; `NEEDS_HUMAN_REVIEW` when unsure; never calculate final pay or modify approved config; cite evidence.
- Injection: policy text and data go into prompts as delimited data, never as instructions. The schema fixes the output shape. AI text is rendered as plain text (no HTML).
- OpenRouter: `response_format` JSON schema + `provider.require_parameters`; our validation is still mandatory. Account opted out of training; per-request no-retention providers; `:free` models only with fake data; $5 spend cap on the key.
- Model choice: run the fixtures 3 times on 3 cheap models; default = the cheapest with 100% final ACCEPTED/REPAIRED and ≥ 90% first try; the runner-up is the fallback.
- Outage: fallback model, then `NEEDS_HUMAN_REVIEW`. The judge demo company is seeded with an approved config and finished runs, so it works with the AI down.

## 8. Data ingestion

- CSV parsed in the browser (limits in `docs/security.md` S25, safe parser, no formula evaluation) -> column mapping (human-confirmed; AI suggestions see headers only) -> anonymise: only mapped columns are uploaded, worker names become pseudonymous IDs (W001…), and the name key downloads to the user's own PC, encrypted with their passphrase (re-opened locally on the next import to keep codes stable) -> server normalization -> validation -> import batch. Names and bank details never reach the server.
- The server re-checks the same limits and accepts only mapped, typed fields (worker ref `^W\d{3,}$`, numbers, dates, enums); browser checks are UX, server checks are security. Import request bodies are never logged.
- Import types: workers/compensation, schedules, timesheets, leave records, amounts actually paid (for variance).
- Currency: USD only; any other currency is rejected.
- Duplicates are detected by natural key (worker + date/period + source type) and by content hash; re-importing the same data is idempotent.
- Each batch keeps the content hash, mapping, row counts and rejected rows. The raw file is not stored.
- CSV exports escape cells starting with `=`, `+`, `-`, `@`, tab or CR.
- Deletion on request: a script removes all data of one company.
- Provenance: every imported record carries its source provider (`csv_upload` in the MVP), object type, object ID (the natural key for CSV), fetched at, hash of the normalized record and reference (import batch). Run snapshots reference evidence IDs and source hashes. Future connectors produce the same normalized evidence and enter this same path (§24).

## 9. Reconciliation and exceptions

- Deterministic checks detect; `ReconciliationAgent` proposes a classification with evidence; validators confirm the category is allowed and the evidence is real.
- MVP categories: `UNEXPLAINED_MISSING_HOURS` (salaried), `DUPLICATE_TIMESHEET`, `UNAPPROVED_OVERTIME` (hours above threshold or contracted cap without approval), `LEAVE_WORK_CONFLICT`. System categories: `AI_OUTPUT_INVALID`, `PAYMENT_EXCEPTION`, `SETTLEMENT_MISMATCH`.
- Missing time (salaried) is classified as paid leave, unpaid leave, approved adjustment, different schedule or unexplained. Unexplained always becomes an exception.
- Fields: ID, run, worker, category, severity, source evidence, detected facts, rule IDs, AI suggestion, validation result, human resolution, resolver, timestamp.
- States: `OPEN -> IN_REVIEW -> RESOLVED | REJECTED | ESCALATED`. An AI suggestion is never a resolution.
- Unresolved exceptions block their own stage: reconciliation categories block calculation; `PAYMENT_EXCEPTION` and `SETTLEMENT_MISMATCH` block `RECONCILED` and `closeRun`.
- "Why was this flagged?" is answered from stored evidence, not from an LLM.
- Match status per imported record: `AUTO_MATCHED` (no check fired), `MATCHED_AFTER_REVIEW` (its exceptions resolved), `EXCEPTION` (open). The auto-match count is computed from it, never estimated.
- Bulk resolve: one category, one required note, all-or-nothing, one resolution + audit event per exception (`docs/security.md` S60). Approvals stay one at a time.
- Table views (`docs/pages.md` §5): a view definition is validated data (allow-listed columns and operators per table); filter, sort, totals and export run on the server in the scoped repositories (S59).

## 10. Payroll engine and trace

Pure function: approved config version + worker snapshot + reconciled input snapshot -> calculation. Same inputs always give the same result and hash. Snapshots are stored immutably.

```text
SALARIED  Gross = base + overtime(approved hours above weekly threshold x hourly rate x multiplier)
                  - unpaid-time deduction(unpaid hours x hourly rate)
          hourly rate = base per period / scheduled hours per period (full precision)
HOURLY    Gross = approved hours up to cap x rate + approved hours above cap x rate x multiplier
RETAINER  Gross = fixed retainer per period (+ approved extra hours x agreed rate, if configured)
Deductions = sum of configured percentages of gross
Net = Gross - Deductions
```

- Paid leave: no deduction. Unapproved overtime or above-cap hours are excluded unless an exception resolution approves them.
- Every line records: component, source record IDs, rule ID + version, inputs, calculation step, amount.
- `calculation_hash` = SHA-256 of a canonical serialization of config version, snapshots, lines and totals.
- Independent checks before `CALCULATION_VALIDATED`: net = gross − deductions; no negative net; every line traced; recomputation reproduces the hash; totals match line sums.
- AI may explain a trace; it cannot edit it.

## 11. Payroll run state machine

```text
DRAFT -> DATA_IMPORTED -> RECONCILING -> EXCEPTIONS_PENDING -> READY_FOR_CALCULATION
-> CALCULATED -> CALCULATION_VALIDATED                 (SIMULATION ends here)
-> PENDING_APPROVAL -> APPROVED | REJECTED             (REJECTED is terminal; start a new run)
APPROVED -> OBLIGATIONS_CREATED -> PAYMENT_IN_PROGRESS (first batch authorized) -> SETTLED -> RECONCILED
PAYMENT_IN_PROGRESS -> PARTIALLY_SETTLED | PAYMENT_FAILED
PARTIALLY_SETTLED | PAYMENT_FAILED -> PAYMENT_IN_PROGRESS (new batch authorized, or after exception resolution)
```

- Transitions happen only in core services, guarded, as atomic compare-and-set (`UPDATE … WHERE state = expected`). Never from LLM output, webhook payloads or client input: APIs take action names, never target states. After `APPROVED`, run inputs are frozen (imports past `READY_FOR_CALCULATION` are rejected); a change needs a new run.
- `PARTIALLY_SETTLED` includes runs with `ON_HOLD` obligations awaiting release.
- `SETTLED` when every obligation is SETTLED; `RECONCILED` when every obligation is SETTLED and matched.
- Failed validation keeps the current state and records why. Each transition writes an audit event.

## 12. Roles and approvals

- `HR_APPROVER`: config, imports, exceptions, payroll approval. `PAYMENT_APPROVER`: payment plan signing, hold release, standing authorization, per-payment ceiling, confirming recipient changes. Both can view everything in their company.
- Roles are read only from `app_users` (never user-editable auth metadata; users cannot write their own row). Public sign-up is disabled; users are created by `scripts/create-users.ts`.
- Accounts: Supabase Auth, passwords ≥ 12 chars. Companies with `mfa_required` (every real pilot company) require TOTP MFA (`aal2`), checked by the server auth guard and by RLS; enrolment on `/account`. The judge demo company is exempt (synthetic data, cannot pay).
- Four-eyes: a run's payment authorizer must differ from its payroll approver. A DB trigger on batch authorization enforces it (for a standing authorization, against its creator at use time); audited. Limitation: one person holding two accounts defeats it, so user provisioning is admin-only.
- Payroll approval records the `calculation_hash` it approved.
- A recipient change (external address or wallet) must be confirmed by the other role before it can enter an obligation.
- Plan signing shows destination, amount, network and token (Circle rule) per obligation, the planner's flags and holds, recipient changes, a config-version change and the total delta vs the previous run, and requires re-authentication.
- Re-authentication = the server verifies the user's password in the same request (never a client flag). Required for authority-granting actions: payroll approval, plan signing, hold release, standing-authorization create, per-payment ceiling change, recipient confirmation. Not required for actions that only reduce authority: revoke standing authorization, place hold, live payments OFF. Failures are audited and rate-limited.

## 13. Payroll obligation

Created automatically only when a LIVE_TESTNET run reaches `APPROVED`. The payment layer never recalculates.

Fields: obligation ID, run ID, worker ID, approved amount (micro-USDC), currency (USDC), recipient wallet (snapshot at approval), config version, calculation ID, approved calculation hash, approval ID, batch ID (when authorized), idempotency key (UUID v4, generated once), on-chain key (keccak256 of the obligation UUID), status, transaction hash, timestamps.

Immutable after insert except status, batch ID, tx hash and timestamps (DB trigger). Calculations, lines, snapshots and approvals are fully immutable.

States: `CREATED -> AUTHORIZED | ON_HOLD`; `ON_HOLD -> AUTHORIZED` (only via a new signed batch); `AUTHORIZED -> PAYING -> SETTLED | PAYMENT_EXCEPTION`.

## 14. Payments

### 14.1 Wallets (Circle developer-controlled, EOA, `ARC-TESTNET`)
- **Approver wallet**: company treasury; owns `PayrollGuard`; funds batches. Holds at most the next batch plus gas; the reserve stays in a wallet the user holds outside Circle.
- **Agent wallet**: guard operator; holds only a small USDC gas balance (Arc gas is paid in USDC).
- **Worker wallets**: one per worker in a worker wallet set, created at onboarding with an idempotency key; only wallet ID + address are stored. Alternative: a worker-supplied address, confirmed by the other role (§12).
- Funding: Circle faucet first; TestMint (up to $10k testnet USDC) as a bonus. The demo LIVE run is ≤ 100 USDC total. Testnet only.

### 14.2 PayrollGuard contract (Solidity, Foundry)
- Constructor: USDC address, owner (approver wallet), operator (agent wallet); rejects zero addresses and owner = operator. The deployer key has no role after deployment. No upgrade path, no arbitrary withdraw; no function edits a committed entry.
- `openRun(runKey, keys[], recipients[], amounts[])` (owner): one guard run per payment batch (runKey = keccak256 of the batch UUID). After an exact `approve` (never unlimited), pulls exactly `sum(amounts)` and records each key -> (recipient, amount). Rejects length mismatch, zero amount or recipient, duplicate keys, a reused `runKey`, and any key already paid or committed in another open run. Called only by the server after a batch is AUTHORIZED (the plan-signing handler or the standing-authorization system path), with the obligation set loaded from the DB, never from the request.
- `pay(obligationKey)` (operator): requires an open run and a committed, unpaid key; marks it paid, then transfers the committed amount to the committed recipient (checks-effects-interactions); emits `ObligationPaid(runKey indexed, obligationKey indexed, recipient, amount)`.
- `closeRun(runKey)` (owner, once): returns the unpaid balance; `pay` then fails for that run. `isPaid(obligationKey)` view. `replaceOperator(newOperator)` (owner; new operator ≠ owner).
- Server side: owner calls exist only in `src/server/circle/guard-owner.ts` (approver wallet), imported only by batch authorization, batch close and `scripts/`. `ArcUsdcRail` encodes only `pay(bytes32)` from the agent wallet ID.
- Keys are keccak256 of random internal UUIDs. Net amount and recipient address are public by nature (§19).
- Caveat: one Circle credential set (API key + entity secret) controls both owner and operator, so the contract bounds the agent code path, not a compromised server. Accepted for testnet with the limits in §14.1 and §19; post-hackathon the payment approver holds the owner key.

### 14.3 PaymentRail
- Core interface: submit payment for an obligation, get status, verify settlement. Payroll, reconciliation and audit stay rail-agnostic.
- `ArcUsdcRail` (only implementation): Circle contract execution (`abiFunctionSignature` + `abiParameters`) from the agent wallet to `PayrollGuard.pay`; UUID v4 idempotency key per attempt. Other rails are roadmap only.

### 14.4 Payment safety gate (server, before every submission)
One gate function (`src/core/payments/gate.ts`), re-reading everything from the DB by obligation ID; it issues the only value `PaymentRail.submit` accepts, and only the payment agent calls `submit` (initial, retry and recovery alike). Pays only if all of these hold: the obligation exists and is AUTHORIZED; obligation, batch, run and authorization belong to the same company; it belongs to an AUTHORIZED or OPEN batch whose stored `plan_hash` matches recomputation; the authorizer (or the standing authorization's creator) differs from the payroll approver; the run is LIVE_TESTNET and APPROVED or later, in a company with live payments enabled; the approval's `calculation_hash` matches the calculation and the amount equals its line; currency USDC, network Arc testnet; recipient equals the approved snapshot; idempotency key unused; amount ≤ per-payment ceiling; guard run open with this obligation committed and unpaid. Batch level, before `openRun`: sum of batch obligations = plan total, and the treasury holds the total plus gas. Any failure: do not pay; create `PAYMENT_EXCEPTION`.

### 14.5 Payment agent
A capability-limited service, not a free-roaming LLM. Its tools accept only an obligation ID: list authorized obligations in plan order, check eligibility (gate), submit, get status, reconcile, report failure. On-chain it can only call `pay(obligationKey)`. It cannot change salary, rules, amounts, recipients or plans, approve anything, or create obligations.

### 14.6 Payment states, idempotency, retry, crash recovery
- States: `NOT_SUBMITTED -> SUBMISSION_PENDING -> SUBMITTED -> CONFIRMED | FAILED | UNKNOWN`.
- Circle mapping: INITIATED/WAITING/QUEUED/CLEARED/SENT/CONFIRMED -> SUBMITTED; COMPLETE -> CONFIRMED only after settlement reconciliation passes; FAILED/DENIED/CANCELLED -> FAILED; STUCK, timeout or no response -> UNKNOWN.
- One Payment per obligation. Submission first claims the obligation by compare-and-set (AUTHORIZED -> PAYING); only the claimant submits. Each attempt row (idempotency key, `SUBMISSION_PENDING`) is saved **before** the Circle call; the Circle transaction ID is added after.
- On UNKNOWN or timeout: query Circle by transaction ID and `isPaid` on Arc. Resubmit only when Circle shows a terminal failure and `isPaid` is false; otherwise wait or escalate.
- Crash recovery (recover route, on demand and on dashboard load): for each PAYING obligation older than a few minutes: `isPaid` true -> find the `ObligationPaid` log by indexed key -> settlement reconciliation; `isPaid` false -> ask Circle: no record -> resend with the **same** idempotency key; pending -> wait; terminal failure -> new attempt. The guard's one-payment-per-key rule is the on-chain backstop.
- Webhooks are hints: verify the signature, dedupe (`webhook_notifications`), then re-query Circle and Arc. A payload never sets state directly, and the webhook handler never calls the gate or rail.
- The recover route is authenticated, scoped to the session's company, idempotent and rate-limited; it resubmits only through the gate, so the kill switch applies.
- The attempt ID goes into Circle's `refId`, linking our records to the Circle transaction.
- The same idempotency discipline applies to imports, wallet creation and reconciliation jobs.

### 14.7 Payment batches and Payment Planner
- `payment_batches` states: `PROPOSED -> AUTHORIZED | DISCARDED`; `AUTHORIZED -> OPEN (openRun) -> COMPLETED | CLOSED` (CLOSED = `closeRun` returned an unpaid remainder).
- Signals (deterministic, `src/core/payments/signals`): `AMOUNT_RATIO` (≥ 2× or ≤ 0.5× the mean of the worker's last 3 settled runs), `RECIPIENT_CHANGED`, `FIRST_PAYMENT`, `CONFIG_VERSION_CHANGED`. Stored with the plan.
- Planner input (via §7 inputs): obligation IDs, pseudonymous worker keys, amounts, fired signals, treasury balance, batch total. No names or addresses.
- Planner output: ordered batch obligation IDs; holds `{obligationId, reasonCode (enum), signalIds}`; flags `{obligationId, signalIds}`; plain-text rationale.
- Validation (protected invariant): every obligation of the run not yet paid appears exactly once (batch or hold); no unknown IDs; amounts and recipients unchanged; cited signals exist and fired; reason codes from the enum.
- Fallback when the planner fails: one batch, all obligations in obligation-ID order, no holds, marked `FALLBACK` in the UI and audit. Signals are still shown.
- The payment approver may only move obligations between batch and hold, then signs. `plan_hash` = SHA-256 over the canonical final plan (ordered obligation IDs, amounts, recipients, held IDs, AIExecution ID or `FALLBACK`). Execution follows the plan order.
- Holds: `ON_HOLD` is not an exception and is shown separately. Only the payment approver releases held obligations, by starting a new batch (planned and signed like any other). Nothing auto-releases.
- If P4b is cut: no planner, fallback plan only; batches, holds by the approver and signing still apply.

### 14.8 Standing authorization
- Signed once by a payment approver: max batch total, max per payment, expiry; revocable at any time. Stored in `standing_authorizations`.
- Applied by the system path right after a valid plan exists, only if: no holds, no fired signals, no recipient change, same config version as the previous run, non-fallback plan, not revoked, same company, batch total and every payment within its limits and the company ceiling, before expiry, and its creator ≠ the run's payroll approver (DB trigger). Each condition has a negative test (`docs/security.md` S09).
- The batch is recorded as authorization type `STANDING` with the rule ID; everything else needs a human signature (`HUMAN`). Payroll approval always stays human.

## 15. Settlement reconciliation

Independent of Circle status. Read the receipt from Arc RPC (viem) and match:
obligation -> transaction hash -> success status -> chain ID 5042002 -> `ObligationPaid` from the guard address with the same key, recipient and amount -> the ERC-20 USDC `Transfer` log from `0x3600…0000` (to recipient, 6-dp value).

- The same transfer also emits an 18-dp system `Transfer` log from `0xffff…FfFE` (EIP-7708). Ignore it; never count both.
- Arc finality is deterministic: one confirmed receipt is final.
- Only a full match marks the obligation SETTLED. Any mismatch -> `SETTLEMENT_MISMATCH`, never auto-fixed. When all of a batch's obligations match, `closeRun` returns any remainder; when all of the run's obligations match, the run moves to RECONCILED.

## 16. Variance report (SIMULATION value)

Import the amounts the business actually paid and compare them per worker to engine output. Each difference above tolerance becomes a finding with evidence and trace. AI may explain variances; it never edits amounts. Findings from real pilot data count toward traction.

## 17. Data model (Supabase Postgres, every row carries `company_id`)

`companies` (live_payments_enabled, mfa_required, per-payment ceiling), `company_keys` (wrapped data key, key version), `app_users` (role), `payroll_configurations` (+ policy clauses), `payroll_rules`, `workers` (pseudonymous code, pay type, wallet ID, address, wallet source CIRCLE|EXTERNAL, confirmed by), `compensations` (base, rate or retainer), `schedules`, `import_batches` (source provider, content hash), `timesheets`, `leave_records`, `actual_payments`, `payroll_runs` (mode, config version, approvers), `reconciliation_results`, `exceptions`, `payroll_calculations` + `calculation_lines` + snapshots, `approvals` (calculation_hash), `payroll_obligations`, `payment_batches` (plan, plan_hash, signals, planner AIExecution or FALLBACK, authorization type HUMAN|STANDING, authorized by, guard run key), `standing_authorizations`, `payments` + `payment_attempts`, `variance_findings`, `ai_executions`, `webhook_notifications` (provider + notification ID unique; Circle is the first provider), `audit_events`.

Key relations: config has versions and rules; a run references one config version; a calculation references config + snapshots; an obligation references one approved calculation line and at most one batch; a payment references one obligation. Money columns are integer micro-USDC; fields that reveal pay levels or policy are stored encrypted (§17.1). Foreign keys are composite `(company_id, id)`, so a row can never reference another company's row. Import-derived rows (workers/compensations, schedules, timesheets, leave records, actual payments) carry provenance columns (§8). CHECK constraints and unique indexes back the invariants and idempotency (`docs/security.md` S26, S35).

### 17.1 Data protection
- In transit: HTTPS only (TLS 1.2+, HSTS). At rest: Supabase AES-256 disks, plus Kleeno field encryption. That is AES-256-GCM with a per-company data key wrapped by `DATA_ENCRYPTION_KEY`; the AAD binds company + table + column + row. `src/server/crypto` holds it; only the `src/server/db` repositories call it; core sees plaintext.
- Encrypted: policy clause text, compensation, snapshots, calculation line inputs and amounts, gross and deduction totals, actual-paid and variance amounts. Plain: IDs, states, dates, hours, hashes, enums, config percentages, net obligation amount (public on-chain). DB CHECKs apply to plain columns; core validates encrypted values before writing.
- Deleting a company deletes its wrapped key. Key rotation re-wraps company keys (`scripts/rotate-data-key.ts`). Details and limits: `docs/security.md` §0.

## 18. Audit trail

`audit_events` is append-only: a DB trigger rejects UPDATE/DELETE and those privileges are revoked. This binds the service role too; RLS alone would not. Fields: event ID, actor + actor type (user, AI, system, agent), action, entity + ID, before/after references, source reference, trace/correlation ID, timestamp. One correlation ID per request flows through AIExecution, audit events, payment attempts, Circle `refId` and settlement.

Audited: policy submission, AI proposal, validation failure, config approval, import, reconciliation, exception create/resolve, calculation, calculation validation, payroll approval, obligation creation, recipient change, plan proposal (or fallback), plan signing (human or standing), hold and release, standing authorization create/revoke/use, submission, retry, gate DO NOT PAY, recovery action, confirmation/failure, settlement reconciliation, kill-switch change, ceiling change, re-auth failure, operator replacement, user provisioning. The audit screen links policy -> data -> exception -> calculation -> approval -> obligation -> plan -> transaction.

## 19. Security (threat register)

Controls described elsewhere are referenced by section; only controls that live nowhere else are spelled out here. The per-phase checklist, secret inventory, emergency stop, test matrices and accepted risks are in `docs/security.md`.

| Threat | Control | Phase |
|---|---|---|
| Compromised agent/operator path | Committed obligations only (§14.2); gate (§14.4); obligation-ID-only agent (§14.5) | P1, P4 |
| Server or Circle credential compromise (owner + operator) | DB-derived `openRun`, exact `approve` per batch (§14.2); treasury holds at most the next batch + gas, reserve outside Circle (§14.1); testnet funds only; owner key to the payment approver post-hackathon | P1, P4 |
| Cross-company access / IDOR | RLS on every table, tested in `tests/db/`; composite company FKs (§17); handler rules (§4) | P2 |
| Direct writes through Supabase's public API (user JWT) | `authenticated` SELECT-only, `anon` nothing; all writes via server repositories (§4) | P2 |
| Payment after an incident or on the demo company | Kill switch in server + DB trigger (§5); emergency stop (`docs/security.md` §2) | P1, P2, P4 |
| Payment path around the gate | Single gate; rail accepts only a gate pass; webhook/recovery never pay directly (§14.4, §14.6) | P1, P4 |
| Agent gains owner powers | Owner calls isolated in `guard-owner.ts`; contract role tests (§14.2) | P1 |
| Guard key reuse / double pay across batches | `openRun` rejects paid or open-committed keys (§14.2) | P1 |
| Tampering with approved figures | Immutability triggers (§13); frozen inputs after approval (§11) | P2 |
| Clickjacking, header gaps, receipt Referer leak | CSP `frame-ancestors 'none'`, `nosniff`, Referrer-Policy (receipt `no-referrer`) in `next.config.ts` | P2, P4 |
| Server Actions / proxy-only auth | No Server Actions; every handler authenticates; proxy is not auth (§4) | P2 |
| Privilege escalation, insider, stolen session | Roles, DB-enforced four-eyes, recipient-change confirmation, deltas, re-auth for authority-granting actions (§12); `Origin` check (§4); SameSite=Lax auth cookies | P2, P4 |
| Audit tampering | Append-only trigger + revoked privileges (§18) | P2 |
| Races / double submit / crash mid-payment | Compare-and-set (§11, §14.6); attempt saved before the Circle call and recovery (§14.6); guard one pay per key | P1, P4 |
| Webhook spoof or replay | Verify `X-Circle-Signature` with the public key for `X-Circle-Key-Id` over the raw body; dedupe by notification ID (`webhook_notifications`); body size limit; re-query Circle + Arc | P4 |
| Prompt injection / XSS, malicious CSV | Single input builder `src/core/ai/inputs/` with strict schemas (§7); plain-text rendering; §8 upload limits and export escaping | P3 |
| Planner manipulation or bad plan | Plan invariant (§14.7); human or standing signature over `plan_hash`; gate re-checks every obligation | P4b |
| Standing authorization abuse | Limits, expiry, revocation, strict eligibility, four-eyes at use, audit (§14.8) | P4 |
| Secret leak (public repo, logs, bundle) | Env files and Vercel env only; `server-only` + Zod `env.ts`; no `NEXT_PUBLIC_` secrets; redacting logger, never log raw SDK errors (they carry auth headers); gitleaks in CI and before going public; recovery file outside the repo; Foundry encrypted keystore; Circle `TEST_API_KEY` only; secrets in Vercel Production scope only (not Preview) | P0 |
| Payroll privacy on-chain | Net amount, address and hashed keys are public by nature; no name↔address mapping in public material; worker consent | P1, P5 |
| Receipt link leak (reveals pay) | HMAC token per obligation with expiry; constant-time compare; noindex; rate limit; no name shown | P4 |
| Public demo abuse | Judges use the SIMULATION-only demo company (§5); AI endpoints rate-limited; $5 OpenRouter cap | P5 |
| Database, backup or log leak of business data | Field encryption (§17.1); names never on the server (§8); no payroll values in logs or audit payloads | P2, P3 |
| Account takeover | Supabase Auth, ≥ 12-char passwords, TOTP MFA for real companies (§12), re-auth for payment authority, rate-limited logins | P2 |
| AI data exposure, real business data | In-browser anonymisation, names never reach the server (§8); §7 inputs; written consent; deleted on request; kept apart from the demo company | P3 |
| Spoofed or compromised external source or connector | Evidence only, never authority; same validation and reconciliation; webhooks re-fetched; provenance (§24) | P3 provenance, later connectors |
| Integration token leak | Per-company tokens encrypted with the company key (S41); least-privilege scopes; revoke on disconnect; never logged or sent to AI (§24) | Later |
| Data exfiltration or actions through an AI client (MCP) | Read-only tools only; same auth, RLS, role, MFA and object checks; per-company opt-in; minimal fields; rate limits; audit (§24) | Later |
| Payroll data in chat notifications | Counts, state and link only (§24) | Later |
| Supply chain; dev plugins | Lockfile; dependencies only from official docs; `npm audit` in CI; CI holds no secrets; Ponytail v4.7.0 hooks are local with no network calls (reviewed 2026-09-29), re-review on update | P0 |
| Wrong chain or decimals | Chain ID 5042002 checked by the viem reader; Circle blockchain `ARC-TESTNET`; 6-dp ERC-20 values only (§15) | P1 |

## 20. Verification

- Vitest unit tests for core; `tests/invariants/` for invariants and fixture acceptance; `tests/db/` for RLS on every table, append-only audit, four-eyes trigger and compare-and-set, run against local Supabase in GitHub Actions; Foundry `forge test` for the guard (standard EVM with an ERC-20 mock; Arc behaviour is proven by one real testnet pay in P1); Playwright (Chromium) e2e for the demo path. CI runs all of them on every push.
- Protected (add freely; never weaken or delete without user approval): `tests/invariants/`, `tests/fixtures/`, `contracts/test/`.
- Fixtures: normal salary; 40 scheduled / 48 worked / 8 approved overtime; 32 worked + 8 paid leave; 36 worked, no leave -> exception; duplicate timesheet -> detected; payment timeout -> retry without double payment; hourly: approved hours × rate, unapproved above-cap hours excluded; retainer: fixed amount per period; crash after the Circle call -> recovery settles once; planner output with a missing, extra or altered obligation -> rejected.
- Invariants: net = gross − deductions; obligation = payment = on-chain amount; SIMULATION cannot pay; same inputs -> same hash; no obligation without payroll approval; no payment without authorization by a different user; payment plan covers every obligation exactly once, unchanged; execution matches the signed `plan_hash`; AI output never becomes an amount; the guard pays only committed obligations, once each, from the operator only.
- Security tests: every control in `docs/security.md` §3 names its test file, including the gate matrix, standing-authorization negatives, RLS/IDOR, state-machine, AI privacy/injection, webhook, failure and crash matrices. Each `Pn.md` lists that phase's rows.
- Demo fixtures prove the software behaves correctly, not that real payroll is correct.

## 21. Environments and deployment

- Supabase: `kleeno-dev` (building) and `kleeno-prod` (demo) cloud projects, sign-up disabled. No Docker locally; the Supabase CLI runs via npx; DB tests run in GitHub Actions against local Supabase.
- Vercel: production deploys from `main` with `kleeno-prod`; secrets only in Vercel env. No public payment route before P2 auth.
- Freeze: tag `demo-freeze` on Oct 8; after it, migrations are additive only. Back up the prod DB (`supabase db dump` via npx) before the Oct 9 deploy. Rollback: Vercel Instant Rollback to the last good deployment.
- Demo setup: Chrome desktop at 1440px; the receipt page also at 390px.

## 22. References

- Local Arc/Circle context: `../Arc Comtext/AGENTS.md`; `../Arc Comtext/docs/circlefin-skills/{use-arc,use-usdc,use-circle-wallets,use-developer-controlled-wallets}.md`; `../Arc Comtext/docs/docs.arc.network/arc/references/{evm-differences,usdc-system-events}.md` (local mirror; live site is docs.arc.io); sample `samples/arc-fintech`.
- Arc testnet: chain ID 5042002, RPC `https://rpc.testnet.arc.network`, explorer `https://testnet.arcscan.app`, USDC `0x3600000000000000000000000000000000000000`, faucet `https://faucet.circle.com`.
- Check current official docs (docs.arc.io, developers.circle.com, openrouter.ai/docs) before writing integration code.
- Hackathon: tameion.thecanteenapp.com (rules, judging, submission form).

## 23. Open items

- Overtime week boundaries for non-weekly periods and partial weeks: decided in `docs/phases/P2.md`.
- Market confirmation (US contractors first) and real pilot data: in progress outside the build.
- Owner key held by the payment approver instead of the server: post-hackathon.
- Names from server-side HRIS connectors vs rule 35: decided before the first HRIS connector (`docs/integrations/README.md` §3.10).

## 24. Integrations and MCP (designed; mostly built after the hackathon)

- Design: `docs/integrations/`; decisions: `docs/decisions/`; rules 51–55; security rows S46–S50.
- External systems are evidence sources or destinations. A connector produces the same normalized evidence as the CSV import (§8), with provenance, then follows the same validation, reconciliation and snapshot path. Code asks for capabilities, not vendors; vendor code lives only in `src/server/integrations/<provider>/`.
- MVP (P3): capability and category types, provider descriptor registry with `csv_upload`, `requireCapability`, provenance columns, snapshot evidence references.
- Later: `integration_connections` (lifecycle, tokens encrypted per company), `integration_sync_runs`, webhooks through `webhook_notifications`, ports `EmploymentEvidenceSource`, `AccountingDestination`, `DocumentSource`, `Notifier`. Also: the read-only Kleeno MCP (Supabase OAuth 2.1, same guard as handlers), a deterministic journal export with explicit account mapping, and SSO through Supabase Auth with roles only from `app_users`.
