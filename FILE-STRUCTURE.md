# Kleeno — File Structure

Repository tree. `[Pn]` = the phase that creates it. Folder names are binding. File names inside a folder may be refined by the phase that creates them; update this file in the same commit.

Rules:
- `src/core/` never imports `src/server/`, `src/app/`, Next.js, Supabase, Circle, viem or OpenRouter. `src/core/validation/` never imports `src/core/ai/`. Everything in `src/server/` imports `server-only`.
- Backend (Ponytail allowed): `src/core`, `src/server`, `src/app/api`, `src/proxy.ts`, `supabase/`, `contracts/`, `scripts/`. UI (no Ponytail): the other `src/app` folders and `src/components`.
- UI (pages, `src/components`, `globals.css`) follows `DESIGN.md` (ESSENTIALS rule 45); design tokens are defined only in `src/app/globals.css`.
- Security controls (S01–S50) name the file their test lives in: `docs/security.md` §3.
- Background notes (old decisions, original spec, planning answers) live outside the repo in `../Kleeno-notes/`; agents do not read them.

```text
Kleeno/                                  repo root = Next.js app root
├─ CLAUDE.md                             agent entry point
├─ PROGRESS.md                           session state: phase, done, in progress, blocked, next
├─ ARCHITECTURE-ESSENTIALS.md            non-negotiable rules + precedence
├─ ARCHITECTURE.md                       technical design, threat register
├─ PRD.md                                scope, modes, demo, acceptance criteria, timeline, cuts
├─ FILE-STRUCTURE.md                     this file
├─ DESIGN.md                             visual design system (colours, type, radii, components); UI must follow it
├─ README.md                        [P5] what, how to run, demo link, traction
├─ .claude/settings.json            [P0] project agent settings: env PONYTAIL_DEFAULT_MODE=off; no secrets
├─ .env.example                     [P0] env var names only, no values
├─ .gitignore                       [P0] .env* (except .env.example), *.pem, *-recovery-file.json, keystores, contracts/out
├─ package.json                     [P0] scripts: dev, build, lint, test, test:invariants, test:db, test:e2e; lockfile committed
├─ tsconfig.json / next.config.ts   [P0] TS strict mode, Next.js config; security headers (CSP, frame-ancestors, Referrer-Policy) [P2]
├─ vitest.config.ts                 [P0] unit + invariant runner
├─ playwright.config.ts             [P5] e2e runner (Chromium)
├─ .github/workflows/ci.yml         [P0] lint, typecheck, vitest, forge test, DB tests (local Supabase), npm audit, gitleaks; no secrets
│
├─ docs/
│  ├─ roadmap.md                    Now / Next / Later; out-of-scope ideas go here (user approves)
│  ├─ pages.md                      page map (13 pages), landing page, UX intent per page
│  ├─ security.md                   security plan: data protection model, secret inventory, emergency stop, controls S01–S50 by phase + test, deferred, accepted risks, status
│  ├─ github.md                     git/GitHub workflow: commit checks, phase branches, PR + CI + squash-merge, going public (P5), hosting checks
│  ├─ integrations/                 integration design: README (boundary, capabilities, provenance, lifecycle), provider matrix, hris-payroll, accounting, expenses, documents, notifications, identity, mcp
│  ├─ decisions/                    ADRs: integration abstraction, HRIS unified API, accounting unified API, Kleeno MCP
│  ├─ phases/                       [P0+] P0.md … P5.md, P4b.md: "Done when" checks, written before each phase
│  ├─ demo-script.md                [P5] video script and click path
│  ├─ traction.md                   [P5] real participants only, "Arc testnet, no real funds"
│  └─ model-eval.md                 [P5] pass rate / retries / cost per model
│
├─ contracts/                       [P1] Foundry project
│  ├─ foundry.toml                  Arc testnet RPC profile
│  ├─ src/PayrollGuard.sol          openRun per batch commits obligations; pay(obligationKey) once each; ObligationPaid (indexed keys)
│  ├─ test/PayrollGuard.t.sol       PROTECTED: guard rules proven (roles, key reuse, input checks; S01–S03)
│  └─ script/DeployPayrollGuard.s.sol  owner = approver wallet, operator = agent wallet; encrypted keystore
│
├─ supabase/
│  ├─ config.toml                   [P0] Supabase CLI config (CLI via npx)
│  ├─ migrations/                   [P1+] schema, RLS by company_id (authenticated read-only, anon none), composite company FKs, CHECKs + unique keys, append-only audit, four-eyes, immutability and kill-switch triggers
│  └─ seed.sql                      [P1] companies (pilot + demo), demo config; no credentials
│
├─ scripts/
│  ├─ setup-wallets.ts              [P1] wallet sets + approver/agent wallets (idempotent)
│  ├─ create-users.ts               [P1] approver and demo users from env; no passwords in the repo
│  ├─ check-balances.ts             [P1] treasury/agent USDC balances on Arc
│  ├─ export-guard-abi.ts           [P1] copy ABI from contracts/out to src/server/arc/
│  ├─ delete-company.ts             [P3] delete all data and the wrapped data key of one company on request
│  ├─ rotate-data-key.ts            [P2] re-wrap company data keys under a new DATA_ENCRYPTION_KEY version
│  ├─ live-payments.ts              [P4] kill switch: on/off per company (only way to turn ON); `off --close-open-runs` = emergency stop; audited
│  ├─ seed-demo.ts                  [P5] 6-worker demo cast + prior settled run (synthetic, labelled)
│  └─ model-eval.ts                 [P5] run fixtures across OpenRouter models
│
├─ src/
│  ├─ proxy.ts                      [P2] Next 16 proxy (was middleware): session refresh, redirects only; not authorization (excludes receipt + Circle webhook)
│  ├─ core/                         pure domain, no I/O
│  │  ├─ money/                     [P1] micro-USDC type, decimal ops, half-up rounding
│  │  ├─ domain/                    [P2] entities; run/config/exception/obligation/batch/payment state machines (compare-and-set)
│  │  ├─ ports/                     [P1] repositories, AiProvider, PaymentRail, ChainReader, Clock, Ids; EmploymentEvidenceSource, AccountingDestination, DocumentSource, Notifier [Next]
│  │  ├─ config/                    [P2] rule catalog, pay types, policy clauses, config versioning + lifecycle
│  │  ├─ engine/                    [P1] calculatePayroll, trace lines, calculation hash (full in P2)
│  │  ├─ validation/                [P3] schema, semantic, evidence validators; invariant checks (plan checks in P4b)
│  │  ├─ ai/                        [P3] AI interfaces, validate-repair pipeline, prompts
│  │  │  └─ inputs/                 [P3] strict input schemas + builders: the only way data reaches a prompt
│  │  ├─ ingest/                    [P3] mapping, normalization, USD check, duplicate detection, name-key file encryption (browser anonymiser shares its types)
│  │  ├─ integrations/              [P3] capabilities, categories, provider descriptors (csv_upload), requireCapability, provenance schema; connection lifecycle [Next]; never names a vendor
│  │  ├─ reconciliation/            [P3] deterministic checks, exception creation, AI classification intake
│  │  ├─ variance/                  [P3] actual-paid vs engine comparison
│  │  ├─ workflow/                  [P2] run service, approvals, four-eyes (extended in P4)
│  │  ├─ payments/                  [P1] obligations, gate.ts (single gate, issues the gate pass), payment agent, retry, settlement matching (full in P4)
│  │  │  ├─ batches/                [P4] batch lifecycle, plan hash, fallback plan, holds, standing authorization
│  │  │  ├─ signals/                [P4] deterministic payment signals
│  │  │  └─ planner/                [P4b] PaymentPlanner intake + validation
│  │  └─ audit/                     [P2] audit event builder, correlation IDs
│  │
│  ├─ server/                       adapters implementing core ports
│  │  ├─ env.ts                     [P0] Zod-validated server env
│  │  ├─ log.ts                     [P1] redacting logger (never raw SDK errors)
│  │  ├─ crypto/                    [P2] field encryption: AES-256-GCM, per-company data keys wrapped by DATA_ENCRYPTION_KEY; called only by db/
│  │  ├─ db/                        [P1] Supabase clients (user-scoped for reads; service role for all writes), repositories that set company_id from context
│  │  ├─ auth/                      [P2] session, auth guard for every handler, role lookup from app_users, re-auth (password in same request)
│  │  ├─ ai/openrouter.ts           [P3] OpenRouter adapter (structured output, privacy flags, model + fallback from config)
│  │  ├─ circle/                    [P1] wallets client, provisioning, guard-owner.ts (only openRun/closeRun/replaceOperator caller), webhook signature verification
│  │  ├─ arc/                       [P1] viem reader: receipts, ObligationPaid + USDC Transfer logs, isPaid; guard ABI
│  │  ├─ rails/arc-usdc-rail.ts     [P1] PaymentRail via PayrollGuard.pay
│  │  ├─ integrations/<provider>/   [Next] connectors, one folder per vendor (the only place vendor code lives)
│  │  └─ mcp/                       [Next] read-only Kleeno MCP tool handlers (docs/integrations/mcp.md)
│  │
│  ├─ app/                          Next.js App Router
│  │  ├─ page.tsx                   [P5] landing page (docs/pages.md §3); placeholder until then
│  │  ├─ privacy/                   [P3] public data and security note
│  │  ├─ login/                     [P2] Supabase auth (sign-up disabled), MFA challenge
│  │  ├─ account/                   [P2] password change, MFA enrolment
│  │  ├─ dashboard/                 [P1] crude in P1, full in P5
│  │  ├─ configuration/             [P3] policy entry, AI proposal, validation log, approval
│  │  ├─ workers/                   [P2] workers, pay types, wallets, recipient-change confirmation
│  │  ├─ import/                    [P3] in-browser parse + anonymise, column mapping, import results
│  │  ├─ exceptions/                [P3] evidence view, AI suggestion, resolution
│  │  ├─ runs/[runId]/              [P1] payroll review, trace, variance, approval (full in P4)
│  │  ├─ settlement/                [P4] payment plan, flags, holds, signing (re-auth), standing authorization, live payments OFF switch, status, reconciliation
│  │  ├─ audit/                     [P5] audit timeline
│  │  ├─ settings/integrations/     [Next] connection cards: status, capabilities, last sync, reauthorize, disconnect
│  │  ├─ receipt/[token]/           [P4] public read-only receipt (signed, expiring, noindex)
│  │  └─ api/                       [P1+] thin handlers (the only mutation surface; no Server Actions): config, imports, runs, exceptions, payments (incl. recover), circle/webhook; mcp [Next]
│  │
│  └─ components/                   [P1+] shared UI (shadcn/ui)
│
└─ tests/
   ├─ invariants/                   [P1+] PROTECTED: invariants + fixture acceptance (payment-plan in P4b); security/ structure + secrets checks [P0+]; gate, kill-switch, standing-auth, AI privacy/injection, webhook, failure + crash matrices; integrations/ (provenance, capabilities, snapshot isolation) [P3]
   ├─ fixtures/                     [P1+] PROTECTED: fixture data + expected results (synthetic, labelled); ai/injection/ [P3]
   ├─ unit/                         [P1+] core unit tests, mirrors src/core
   ├─ db/                           [P2] RLS + write denial on every table, IDOR + handler authz, re-auth, immutability, kill switch, idempotency, integrity, append-only audit, four-eyes, compare-and-set, trace (local Supabase in CI)
   └─ e2e/                          [P5] Playwright demo path (SIMULATION + LIVE_TESTNET smoke)
```

## By phase

Second-agent review: P1, P2, P4 only. Cut order and minimum demo: `PRD.md` §12. Each phase's security rows (`docs/security.md` §3) go into its `Pn.md` "Done when".

- **P0 Setup** (Sep 29–30): git, Next.js + TS strict, Supabase CLI via npx, Vitest, Foundry install + init, CI (gitleaks, npm audit), `env.ts`, `.env.example`, `.gitignore`, `.claude/settings.json` (confirm Ponytail stays off in a fresh session), `PROGRESS.md`, `docs/phases/P0.md`, local gitleaks in `.tools/gitleaks/`, commit email = GitHub noreply, private repo `kleeno` (`docs/github.md` §1). The user creates accounts (checklist in `P0.md`).
- **P1 Thin slice** (Sep 30–Oct 1): money, ports, minimal engine (base salary), obligation + gate + agent, PayrollGuard (committed obligations, indexed keys) + tests + deploy, wallets, users script, ArcUsdcRail, Arc reader, redacting logger, one seeded run paid on Arc testnet and reconciled, crude dashboard/run page. Payments run from scripts or localhost only. Security: S01–S05, S07, S08 subset, S26, S28 timeout, S29 point 2, S30, S35, S38, S39, S45.
- **P2 Foundation** (Oct 2–3): entities, all state machines (run, config, exception, obligation incl. `ON_HOLD`, batch, payment), config versioning, append-only audit trigger, four-eyes trigger, auth + roles (`app_users`, sign-up off, proxy), RLS + `tests/db/`, workers page, full engine (SALARIED, HOURLY, RETAINER) with trace, hash and fixtures; decide overtime week boundaries; first Vercel deploy with auth on (secrets in Production scope only; branch previews off, `docs/github.md` §2). Security: S06 trigger, S10–S15, S17–S20, S32, S34–S36 headers, S40, S41 (compensation + snapshots), S43; `/login` MFA + `/account`.
- **P3 Data + AI** (Oct 4–5): validators, AI inputs module, OpenRouter adapter (fallback model), repair pipeline, AIExecution log, configuration screen; in-browser anonymise + mapping + USD check + dedupe + actual-paid import; reconciliation (4 types) + AI classification + exceptions UI; variance report; delete-company script; integration foundation (provenance + capabilities, `docs/integrations/` §5). SIMULATION works end to end. Security: S21–S25, S41 (policy + actual-paid), S42, S44, S46–S48; `/privacy` page.
- **P4 Payments** (Oct 6–7): full run flow, payroll approval + re-auth, recipient-change confirmation, obligations, signals, batches (fallback plan, holds, signing, plan hash), standing authorization, full gate, retry + crash recovery (fixtures), webhook verification, settlement reconciliation, receipt page, `live-payments.ts` + OFF switch. Security: S05–S09 full, S16, S27–S31, S33, S36 limits.
- **P4b Payment Planner** (Oct 7, can be cut): PaymentPlanner, plan validation + protected payment-plan invariant, flags/holds/rationale in the settlement UI. Security: S21–S23 for the planner.
- **P5 Demo + submission** (Oct 8–10, feature freeze): dashboard, audit timeline, e2e smoke, demo company + seed + rate limits, model eval, backend `ponytail-audit` + `ponytail-debt`, README, traction, demo script, `demo-freeze` tag, DB backup, deploy, going-public checklist + hosting checks (`docs/github.md` §5–6), video, submit. Landing page (`docs/pages.md`). Security: S36 rate limits, gitleaks full history before the repo goes public, final status in `docs/security.md` §6.
