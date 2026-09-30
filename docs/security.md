# Kleeno — Security Plan

The build checklist for the security layer. Rules live in `ARCHITECTURE-ESSENTIALS.md` and the threat register in `ARCHITECTURE.md` §19. Both win over this file on conflict.

How to use it:
- When writing `docs/phases/Pn.md`, copy every §3 row for that phase into "Done when" as a command or test with its expected result.
- At the end of the phase, set each row's Status. The values are `planned`, `built`, `verified` (an automated test or named check passes), `unverified` (give the reason) and `deferred`. Never mark a row `verified` on assumption.
- New security tests go in protected folders (`tests/invariants/`, `tests/fixtures/`, `contracts/test/`) unless a row names `tests/db/` or `tests/unit/`.
- Each security check traces back to exactly one row here. Add a row before you add a control.

## 0. Data protection model
The data is confidential business data. We protect it in layers, strongest first:
1. **Never receive it.** Worker names and bank details stay in the user's browser. The server gets pseudonymous IDs (W001…) and mapped numeric fields only. The name key file (W001 = name) is passphrase-encrypted in the browser and never uploaded (S42).
2. **Encrypted in transit.** HTTPS only (TLS 1.2+, HSTS) from browser to Vercel, and from Vercel to Supabase, Circle and OpenRouter (S40).
3. **Encrypted at rest, twice.** Supabase encrypts its disks (AES-256). On top of that, Kleeno encrypts every field that reveals pay levels or policy (S41). Only the net obligation amount stays plain, because it is public on-chain anyway.
4. **Access-controlled.** Read-only public API under RLS; server-only writes; MFA for real approvers (S43); re-auth for payment authority (rule 47).
5. **Deletable.** Deleting a company removes its rows and its data key (S44).

Honest limit: no web app can calculate payroll on data it cannot read. A fully compromised server (with its env keys) could read decrypted data while it runs. Layers 1–3 make sure a leaked database, backup or log does not expose the data, and the most sensitive data (names, bank details) is never there at all.

## 1. Trust chain (unchanged)
AI proposes -> deterministic validation -> human approval -> deterministic engine -> immutable obligations -> plan authorization -> payment safety gate -> PayrollGuard commitment -> operator-only payment agent -> Arc settlement -> independent reconciliation -> append-only audit.

## 2. Secrets and keys

| Secret | Lives in | Used by | Rotation / revocation / recovery |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | env, Vercel | browser auth | Public by design. Safe only because `anon` has no table rights and `authenticated` is read-only (rule 32). |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `.env.local`, Vercel Production | `src/server/db` system client | Rotate the key in Supabase, update Vercel, redeploy. On a leak: rotate first, then review `audit_events`. |
| `OPENROUTER_API_KEY` | `.env.local`, Vercel Production | `src/server/ai` | Has a $5 cap. Revoke and recreate in OpenRouter. |
| `CIRCLE_API_KEY` (must start `TEST_API_KEY:`) | `.env.local`, Vercel Production | `src/server/circle` | Revoke in the Circle console and create a new key. `env.ts` rejects any other prefix. |
| `CIRCLE_ENTITY_SECRET` | `.env.local`, Vercel Production. The user registers it. The recovery file stays outside the repo. | `src/server/circle` | Rotate in the Circle console with the recovery file. Losing both means losing wallet control (testnet only). |
| Circle wallet and wallet-set IDs | env | `src/server/circle` | Identifiers, not secrets. The agent path reads only the agent wallet ID. |
| PayrollGuard owner / operator | Circle custody (approver / agent wallet); no raw key exists | owner: `guard-owner.ts`; operator: `ArcUsdcRail` | The owner replaces the operator (`replaceOperator`). Post-hackathon, the payment approver holds the owner key. |
| Deployer key | Foundry encrypted keystore outside the repo | `DeployPayrollGuard.s.sol` only | Has no role after deployment. Discard it. |
| Circle webhook public key | fetched from Circle by `X-Circle-Key-Id`, cached on the server | webhook | Public by nature. For an unknown key ID, re-fetch once; otherwise reject. |
| `RECEIPT_HMAC_SECRET` (≥ 32 random bytes) | `.env.local`, Vercel Production | receipt tokens | Rotating it voids every receipt link (accepted). |
| `DATA_ENCRYPTION_KEY` (32 random bytes, base64; versioned) | `.env.local`, Vercel Production; offline copy in the user's password manager | `src/server/crypto` (wraps per-company data keys) | Rotate: add the new version, run `scripts/rotate-data-key.ts` (re-wraps company keys only), then remove the old one. Losing every copy makes encrypted data unrecoverable. On a leak, rotate immediately. |
| Integration OAuth tokens (per company, later) | `integration_connections`, encrypted with the company data key (S41) | `src/server/integrations` | Revoked at the provider and deleted on disconnect. Kleeno's own OAuth app secrets per provider go in env and Vercel Production. |
| Supabase DB password | user's password manager | `npx supabase db push/dump` only | Reset in the dashboard. Never in the repo or CI. |
| User passwords | Supabase Auth | login, re-auth | Created by `scripts/create-users.ts` from env. Never in the repo. |
| GitHub / Vercel tokens | `gh` / Vercel login | deploy | CI holds no secrets. |

**Checks** (row S37):
- Zod `env.ts` validates every server secret at startup.
- `NEXT_PUBLIC_` is limited to the two Supabase public values.
- Every `src/server` file imports `server-only`.
- The redacting logger masks keys, tokens, passwords, receipt tokens and `Authorization`/`X-Circle-*` headers.
- Gitleaks scans the full history.
- Vercel secrets are in the Production scope only; Preview deployments get no Circle or service-role secrets.

**Emergency stop** (server or Circle credentials suspected):
1. The payment approver switches live payments OFF (rule 17).
2. `scripts/live-payments.ts off --close-open-runs` calls `closeRun` on every open guard run.
3. Rotate the leaked secret.
4. Compare `audit_events` with the Arc `ObligationPaid` logs.
5. Re-enable with `scripts/live-payments.ts on`.

## 3. Controls by phase

`inv/` = `tests/invariants/`, `db/` = `tests/db/`, `unit/` = `tests/unit/`, `ct/` = `contracts/test/PayrollGuard.t.sol`.

| ID | Control | Where | Test | Phase | Status |
|---|---|---|---|---|---|
| **Payment authority** ||||||
| S01 | Owner ≠ operator; neither can be the zero address; the deployer has no role | `PayrollGuard.sol` | `ct/` | P1 | passing |
| S02 | Only the owner calls `openRun`/`closeRun`/`replaceOperator`; only the operator calls `pay`; a stranger can call nothing | `PayrollGuard.sol` | `ct/` | P1 | passing |
| S03 | `openRun` rejects: array length mismatch, zero amount or recipient, duplicate key, a key already paid or committed in an open run, a reused `runKey`. `pay` needs an open run. `closeRun` works once. No function edits a committed entry. No upgrade path, no arbitrary withdraw. | `PayrollGuard.sol` | `ct/` | P1 | passing |
| S04 | Owner calls exist only in `src/server/circle/guard-owner.ts`, imported only by batch authorization, batch close and `scripts/`. The rail encodes only `pay(bytes32)` from the agent wallet. | server | `inv/security/structure` | P1 | passing |
| **Kill switch** ||||||
| S05 | `live_payments_enabled = false` blocks: LIVE run creation, plan signing, standing authorization, `openRun`, every submission (gate), and recovery resubmission. Read-only recovery and settlement keep running. | core gate + services | `inv/kill-switch` | P1 gate, P4 all | planned |
| S06 | DB backstop: a trigger rejects batch -> AUTHORIZED and any `payment_attempts` insert while disabled. OFF: payment approver in the UI (no re-auth) or script. ON: `scripts/live-payments.ts` only. Both audited. | `supabase/` | `db/kill-switch` | P2 trigger, P4 UI | planned |
| **Payment gate** ||||||
| S07 | One gate (`src/core/payments/gate.ts`). `PaymentRail.submit` accepts only a `GatePass` that only the gate can create. The gate re-reads by obligation ID and never trusts caller objects. Only the agent calls `submit`; webhook and recovery code never import it. | core | `inv/security/structure` | P1 | passing |
| S08 | Gate matrix, one failing check per case -> DO NOT PAY + `PAYMENT_EXCEPTION`, `submit` never called. Checks: obligation AUTHORIZED; same company across obligation/batch/run; run LIVE_TESTNET and APPROVED+; live payments on; `calculation_hash` + line amount; recipient = snapshot; USDC; Arc testnet; `plan_hash` recomputes; authorizer ≠ payroll approver; idempotency key unused; ≤ ceiling; committed and unpaid on the guard. SIMULATION run rejected. | core | `inv/payment-gate` | P1 subset, P4 full | planned |
| **Standing authorization** ||||||
| S09 | Rejected when: holds, fired signals, recipient change, config version change, fallback plan, expired, revoked, batch > max, payment > max or > company ceiling, creator = payroll approver (DB trigger), other company. A clean batch passes. | `core/payments/batches` + trigger | `inv/standing-authorization`, `db/four-eyes` | P4 | planned |
| **Tenant isolation and DB access** ||||||
| S10 | Every table: `company_id NOT NULL`, RLS on. The test lists tables from the catalog, so a new table without RLS fails it. | `supabase/` | `db/rls` | P2 | planned |
| S11 | `authenticated`: SELECT on its own company only; INSERT/UPDATE/DELETE denied on every table through the public API with a user JWT. `anon`: no table rights. Cross-company SELECT returns 0 rows on every table. | `supabase/` | `db/rls` | P2 | planned |
| S12 | Composite foreign keys `(company_id, x_id)` -> `(company_id, id)`: no row can reference another company's row, even through the service role | `supabase/` | `db/integrity` | P2 | planned |
| S13 | IDOR: a company-A session using a company-B run/calculation/obligation/payment/worker/batch/exception ID -> 404, no write, no data | `src/app/api` | `db/handlers-idor` | P2, extended P3–P4 | planned |
| S14 | Company and role come from session -> `app_users`. Request schemas are `.strict()` with no `company_id`, role, amount, recipient or state. Forged fields -> 400. APIs take action names, never target states. | `src/app/api` | `db/handlers-authz` | P2+ | planned |
| S15 | Every `src/app/api/**/route.ts` calls the auth guard (except the webhook and receipt allowlist); `src/` has no `"use server"`; `proxy.ts` is optimistic only | app | `inv/security/structure` | P2 | planned |
| S16 | Re-auth (password checked by the server in the same request) for payroll approval, plan signing, hold release, standing-authorization create, ceiling change and recipient confirmation. Missing or wrong -> 401, nothing changes, audited. Not required for revoke, placing a hold or switching live payments OFF. | `src/server/auth` | `db/reauth` | P4 | planned |
| S17 | Mutating handlers check `Origin`; auth cookies SameSite=Lax | app | `db/handlers-authz` | P2 | planned |
| **State and immutability** ||||||
| S18 | Machines: run, config, exception, obligation, batch, payment. Test each for valid, invalid, duplicate and stale transitions. Two concurrent transitions: exactly one wins (compare-and-set). AI output, webhook payloads and client input never name a target state. | `core/domain` | `unit/domain`, `db/cas` | P2 (batch/payment P4) | planned |
| S19 | Immutable after insert (trigger binds the service role too): calculations, lines, snapshots, approvals, approved config versions + rules, `ai_executions`, `audit_events`. Obligations may change only status, batch ID, tx hash and timestamps. | `supabase/` | `db/immutability` | P2 | planned |
| S20 | After approval, changing compensation or config or re-importing into the run does not change the approved calculation, hash or obligation amounts. Imports into a run past `READY_FOR_CALCULATION` are rejected. Any change needs a new run. | core + DB | `inv/snapshot-immutability` | P2, P4 | planned |
| **AI** ||||||
| S21 | Input privacy: the adapter's serialized request is captured for every operation, using canary fixtures (names, addresses, notes, raw CSV text, secret-like strings). No canary appears. The payload matches its `inputs/` schema exactly. | `core/ai/inputs` | `inv/ai-input-privacy` | P3 (planner P4b) | planned |
| S22 | Output boundary: AI result types have no writable amount, recipient, config or state fields. Only ACCEPTED/REPAIRED outputs reach intake. Every intake runs schema -> semantic -> evidence -> domain authorization. `core/validation` never imports `core/ai`. | core | `inv/ai-boundary`, `inv/security/structure` | P3 | planned |
| S23 | Injection fixtures (`tests/fixtures/ai/injection/`): instruction override, fabricated amounts, rule IDs or workers, address/recipient in output, HTML/script, "approve"/skip-approval requests, planner adding or altering obligations, rationale with an address or URL. Result: rejected or NEEDS_HUMAN_REVIEW, never ACCEPTED. | core | `inv/ai-injection` | P3 (planner P4b) | planned |
| S24 | AI text and untrusted data render as plain text; no `dangerouslySetInnerHTML` in `src/` | UI | `inv/security/structure` | P3 | planned |
| **Ingestion** ||||||
| S25 | CSV limits in the browser (UX) and again on the server (security): ≤ 5 MB, ≤ 10,000 rows, ≤ 50 columns, ≤ 1,000 chars per cell, UTF-8. Duplicate or empty headers rejected; malformed rows rejected with row numbers. The server takes only mapped typed fields (worker ref `^W\d{3,}$`, numbers, dates, enums, USD). The raw file is never uploaded, stored or logged; import bodies are never logged. Exports escape `= + - @`, tab and CR. | `core/ingest`, api | `inv/csv-security` | P3 | planned |
| **Idempotency** ||||||
| S26 | Unique constraints back every idempotent operation: import content hash per company, natural keys, one wallet per worker (Circle idempotency key saved before the call), one obligation per calculation line, obligation idempotency key and on-chain key, one payment per obligation, at most one non-terminal attempt per payment, one webhook notification ID, one guard `runKey` per batch. Running any of them twice, or concurrently, has one effect. | `supabase/` | `db/idempotency` | P1–P4 | planned |
| **External systems** ||||||
| S27 | Webhook: verify the raw body with `X-Circle-Signature` and the key for `X-Circle-Key-Id`. Bad or missing -> 401, nothing stored. Dedupe on `webhook_notifications`. Body size limit. The handler only triggers a Circle + Arc re-query; it imports no rail, gate or state setter. Replay or out-of-order changes nothing. | `api/circle/webhook` | `inv/webhook` | P4 | planned |
| S28 | Failure matrix (fake rail, chain reader, AI, DB): Circle timeout, outage, pending, failure; Arc RPC down; Arc success + Circle unknown; Circle failed + `isPaid` true; OpenRouter down; DB transient error. Unknown stays unknown. Resubmit only on a proven terminal failure with `isPaid` false. AI falls back, then NEEDS_HUMAN_REVIEW. | core | `inv/payment-failures` | P1 timeout, P4 all | planned |
| S29 | Crash matrix. Crash points: (1) before the Circle call, (2) after the call, before its response, (3) after the response, before the DB write, (4) after the chain tx, before the webhook, (5) after the webhook, before settlement, (6) after settlement, before the run update. Recovery ends with exactly one on-chain payment, one SETTLED obligation and the right run state. | core (fault injection via ports) | `inv/payment-crash` | P1 point 2, P4 all | planned |
| S30 | SETTLED only on a full independent Arc match (§15). Circle COMPLETE alone never settles. A mismatch -> `SETTLEMENT_MISMATCH`. | core | `inv/settlement` | P1, P4 | planned |
| S31 | Recovery route: authenticated, scoped to the session's company, idempotent, rate-limited; resubmits only through the gate | api | `db/handlers-authz` | P4 | planned |
| **Audit** ||||||
| S32 | Every state transition, every §18 event, gate DO NOT PAY, kill-switch changes, ceiling changes, re-auth failures, operator replacement and user provisioning each write exactly one audit event (table-driven over all transitions) | `core/audit` | `inv/audit-coverage` | P2+ | planned |
| S33 | One correlation ID per request, carried to AIExecution, audit events, payment attempts, Circle `refId` (= attempt ID), tx hash and settlement. A seeded LIVE run is traceable from request to settlement. | handlers + core | `db/trace` | P4 | planned |
| S34 | Audit append-only, including the service role | `supabase/` | `db/audit` | P2 | planned |
| **DB integrity** ||||||
| S35 | CHECKs: amounts ≥ 0 (obligation > 0), percentages 0–100, multiplier 1–3, enums, currency `USDC`, chain 5042002. One ACTIVE config per company. SECURITY DEFINER functions set `search_path`. | `supabase/` | `db/integrity` | P1–P2 | planned |
| **Web and secrets** ||||||
| S36 | Headers (`next.config.ts`): CSP with `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (receipt: `no-referrer`), Permissions-Policy. Errors return a generic message + correlation ID, never stacks or SDK errors. Rate limits on AI, re-auth, receipt, webhook and recovery. | app | `unit/headers`, e2e | P2 headers, P4–P5 limits | planned |
| S37 | Secret checks in §2 | server, CI | `inv/security/secrets` | P0 (+ each new var) | built |
| S38 | SIMULATION never reaches payment: state machine, obligation creation, planner, gate and agent all reject it | core | `inv/simulation` | P1–P2 | planned |
| S39 | Chain guard: the RPC must report chain 5042002 before any payment path; Circle blockchain `ARC-TESTNET`; USDC address is a code constant | server | `unit/arc` | P1 | planned |
| **Data protection and accounts** ||||||
| S40 | Transport: HTTPS only; HSTS `max-age=63072000; includeSubDomains`; every server-to-service call uses `https://`; no mixed content | `next.config.ts`, server | `unit/headers` | P2 | planned |
| S41 | Field encryption: AES-256-GCM with a per-company data key wrapped by `DATA_ENCRYPTION_KEY` (`company_keys` table: wrapped key + version). Fresh 12-byte IV per write. AAD = company ID + table + column + row ID, so ciphertext can't move between rows or companies. **Encrypted:** policy clause text, compensation (base, rate, retainer), worker and input snapshots, calculation line inputs and amounts, gross and deduction totals, actual-paid amounts, variance amounts. **Plain:** IDs, states, dates, hours, hashes, enums, config percentages, net obligation amount (public on-chain). Only `src/server/db` repositories call `src/server/crypto`; core sees plaintext. Hashes are computed over plaintext. | `src/server/crypto`, `supabase/` | `inv/security/encryption` (round trip, tamper, wrong AAD, unique IV); `db/encryption` (no plaintext canary in any encrypted column) | P2 compensation + snapshots, P3 policy + actual-paid | planned |
| S42 | Name key file: the browser encrypts it with a user passphrase (≥ 12 chars; PBKDF2-SHA256 ≥ 600,000 iterations + AES-256-GCM, Web Crypto). The file and passphrase are never uploaded. The import re-opens the file locally to keep W-codes stable. A wrong passphrase fails closed. | `src/core/ingest`, import page | `unit/ingest/name-key` (round trip, wrong passphrase, no plaintext name in output) | P3 | planned |
| S43 | Accounts: Supabase Auth, sign-up off, passwords ≥ 12 chars (Supabase hashes them with bcrypt), email confirmation on. In companies with `mfa_required` (all real pilot companies; not the demo company), users must pass TOTP MFA (`aal2`). The server auth guard and RLS (`auth.jwt()->>'aal'`) both enforce it. Enrolment on `/account`. Login and MFA failures are rate-limited and audited. | `src/server/auth`, `supabase/` | `db/mfa` (aal1 on an MFA company: 0 rows, 401 on mutations); named check of the Supabase auth settings | P2 | planned |
| S44 | Retention and deletion: `scripts/delete-company.ts` deletes all rows and the wrapped company key; platform backups age out on Supabase's schedule. The `/privacy` data note says what is kept, where and for how long. | scripts, `/privacy` | `db/delete-company` | P3 | planned |
| S45 | No decrypted field, policy text, import body, passphrase or password in logs, errors, audit payloads or analytics. Audit events store references, never payroll values. | `src/server/log`, `core/audit` | `inv/security/log-redaction` | P1+ | planned |
| **Integrations** (`docs/integrations/`) ||||||
| S46 | Provenance: every import-derived row has source provider, object type, object ID, fetched at, source hash and reference (import batch), NOT NULL; run snapshots reference evidence IDs + source hashes; no raw-payload columns | `core/integrations`, `core/ingest`, `supabase/` | `inv/integrations/provenance`; `db/integrity` | P3 | planned |
| S47 | Capabilities: a source is used only for capabilities its descriptor declares, else `CAPABILITY_NOT_SUPPORTED` (fail closed). No capability for approval, payment, recipient or state change exists. `src/core` names no vendor and never imports `src/server/integrations`. | `core/integrations` | `inv/integrations/capabilities`; `inv/security/structure` | P3 | planned |
| S48 | Snapshot isolation: re-importing the same record gives one record; a changed record after the snapshot creates a new evidence version and leaves the approved snapshot, calculation and hash unchanged | `core/ingest`, `core/engine` | `inv/integrations/snapshot` | P3 | planned |
| S49 | Connectors (when built): tokens encrypted per company (S41), least-privilege scopes, revoke + delete on disconnect, never logged or sent to AI; sync dedupe unique on (company, connection, object type, object ID, version); webhooks verify -> dedupe -> re-fetch; company A cannot use company B's connection; notifications carry counts, state and link only | `src/server/integrations` | `inv/integrations/connectors`, `db/integrations` | Next | deferred |
| S50 | Kleeno MCP (when built): read-only tool list (snapshot test against the absent mutation list); OAuth 2.1 via Supabase Auth; same auth guard, `app_users` role, MFA, company and object checks as handlers; per-company opt-in; rate limits; one audit event per call; no import path to gate, rail, state setters or approval services | `src/server/mcp` | `inv/mcp` | Next | deferred |

## 4. Deferred (post-hackathon, `docs/roadmap.md` Later)
Separate production owner and operator credentials (payment approver holds the owner key). KMS/HSM key management. External immutable log sink. Penetration test. Control mapping (SOC 2 / ISO 27001). Full incident-response runbook. Backup restore exercise (P5 takes a dump; restoring it is not rehearsed). MFA for every user, including demo logins. Session-lifetime policy. Per-company master keys in a KMS (true crypto-shredding of backups). Local name overlay (show real names in the user's browser from the key file). GitHub Actions pinned to SHAs. Legal and compliance review per jurisdiction. Integration connectors and the Kleeno MCP server (S49–S50, `docs/integrations/`).

## 5. Accepted risks (MVP)
- One Circle credential set controls both owner and operator (§14.2). A compromised server could open a run with arbitrary obligations. Limited by DB-derived `openRun`, a treasury holding at most the next batch + gas, the kill switch and testnet funds.
- All writes use the service role (rule 32). A handler that skipped the repository could write across companies. Limited by composite FKs (S12), the IDOR tests (S13) and the structure test (S15).
- One person with two accounts defeats four-eyes; user provisioning is admin-only.
- Net amounts and recipient addresses are public on-chain.
- Receipt URLs can appear in hosting logs; tokens expire.
- Worker wallets are custodial, and we say so openly.
- The data encryption key lives in server env, so a fully compromised running server can decrypt (§0). Deleted companies stay in platform backups until those age out.
- The judge demo company has no MFA (shared logins). It holds synthetic data only and cannot pay.

## 6. Hardening report (2026-09-30, end of P0)
- **Already in place:** Zod `env.ts` with `server-only`; `.gitignore` for secrets; gitleaks and `npm audit` in CI; no `NEXT_PUBLIC_` secrets; S37 structure test.
- **Missing from the design, now added:**
  - Direct writes through Supabase's public API (S11, rule 32).
  - Cross-company foreign keys (S12).
  - Guard key reuse across runs and input checks (S03).
  - Owner/operator split in code (S04).
  - Kill switch coverage, DB backstop and who controls it (S05–S06).
  - Single gate path and company match (S07–S08).
  - Revoked authorization and per-payment max (S09).
  - Re-auth scope (S16).
  - Immutability triggers (S19).
  - Server-side CSV limits (S25).
  - Webhook dedupe table (S27).
  - Secret inventory and emergency stop (§2).
  - Circle LIVE key block and Preview env scoping (§2).
  - Security headers and receipt Referer leak (S36).
  - `middleware.ts` is `proxy.ts` in Next 16, and it is not authorization (S15).
  - Server Actions as public endpoints (S15).
  - Audit and correlation gaps (S32–S33).
  - Failure and crash matrices (S28–S29).
  - AI canary and rationale checks (S21, S23).
  - Recovery route scope (S31).
  - Data protection (added at the user's request): transport (S40), field encryption (S41), encrypted name key file (S42), MFA for real approvers (S43), deletion (S44), no payroll values in logs (S45).
  - Integration readiness (added at the user's request): provenance (S46), capabilities (S47), snapshot isolation (S48); connectors and MCP specified and deferred (S49–S50).
- **Fixed in code:** none yet (no domain code exists).
- **Unverified:** CI jobs (no push yet); Vercel Preview scoping (no Vercel project yet); Circle key prefix check (arrives with the P1 env vars).
