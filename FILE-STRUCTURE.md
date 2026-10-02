# Kleeno — File Structure

Repository tree. `[Pn]` = the phase that creates it. Folder names are binding. File names inside a folder may be refined by the phase that creates them; update this file in the same commit.

Rules:
- `src/core/` never imports `src/server/`, `src/app/`, Next.js, Supabase, Circle, viem or OpenRouter. `src/core/validation/` never imports `src/core/ai/`. Everything in `src/server/` imports `server-only`.
- Backend (Ponytail allowed): `src/core`, `src/server`, `src/app/api`, `src/proxy.ts`, `supabase/`, `contracts/`, `scripts/`. UI (no Ponytail): the other `src/app` folders and `src/components`.
- UI (pages, `src/components`, `globals.css`) follows `DESIGN.md` (ESSENTIALS rule 45); design tokens are defined only in `src/app/globals.css`.
- Security controls (S01–S73) name the file their test lives in: `docs/security.md` §3.
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
├─ vercel.json + .vercelignore     [W] build only Production on Git pushes (no Preview deploys); never upload .env*/tooling with `vercel deploy`
├─ .github/workflows/ci.yml         [P0] lint, typecheck, vitest, forge test, DB tests (local Supabase), npm audit, gitleaks; no secrets
│
├─ docs/
│  ├─ roadmap.md                    Now / Next / Later; out-of-scope ideas go here (user approves)
│  ├─ pages.md                      page map (17 pages), landing page, UX intent per page, dashboard + motion spec (§6)
│  ├─ security.md                   security plan: data protection model, secret inventory, emergency stop, controls S01–S73 by phase + test, deferred, accepted risks, status
│  ├─ github.md                     git/GitHub workflow: commit checks, phase branches, PR + CI + squash-merge, going public (P5), hosting checks
│  ├─ integrations/                 integration design: README (boundary, capabilities, provenance, lifecycle), provider matrix, hris-payroll, accounting, expenses, documents, notifications, identity, mcp
│  ├─ decisions/                    ADRs: integration abstraction, HRIS unified API, accounting unified API, Kleeno MCP
│  ├─ phases/                       [P0+] P0.md … P5.md, P3b.md, P4b.md, P4c.md, P4d.md: "Done when" checks, written before each phase
│  ├─ demo-script.md                [P5] video script and click path
│  ├─ traction.md                   [P5] real participants only, "Arc testnet, no real funds"
│  └─ model-eval.md                 [P5] pass rate / retries / cost per model
│
├─ contracts/                       [P1] Foundry project
│  ├─ foundry.toml                  Arc testnet RPC profile
│  ├─ src/PayrollGuard.sol          openRun per batch commits obligations; pay(obligationKey) once each; ObligationPaid (indexed keys)
│  ├─ test/PayrollGuard.t.sol       PROTECTED: guard rules proven (roles, key reuse, input checks; S01–S03)
│  └─ (no forge deploy script: scripts/deploy-guard.ts deploys from the approver wallet through Circle, so no raw deployer key exists)
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
│  ├─ deploy-guard.ts               [P1] deploy PayrollGuard from the approver wallet via Circle; saves companies.guard_address
│  ├─ live-payments.ts              [P1] kill switch on/off (P4 adds `--close-open-runs`)
│  ├─ seed-run.ts                   [P1] one synthetic LIVE_TESTNET run + authorized batch + on-chain openRun
│  ├─ pay-obligation.ts             [P1] run the payment agent for one obligation ID (scripts only until P2)
│  ├─ _lib.ts                       [P1] shared script helpers (dev company ID)
│  ├─ export-guard-abi.ts           [P1] copy ABI from contracts/out to src/server/arc/
│  ├─ delete-company.ts             [P3] delete all data and the wrapped data key of one company on request
│  ├─ rotate-data-key.ts            [P2] re-wrap company data keys under a new DATA_ENCRYPTION_KEY version
│  ├─ add-platform-admin.ts         [W] grant/revoke access to the private lead list (growth.platform_admins); --prod, --remove, --reset-password, --reset-mfa
│  ├─ probe-site.ts                 [W] lockdown probe: public pages 200, guessed URLs 404, admin path -> login (path never printed)
│  ├─ seed-demo.ts                  [P5] 6-worker demo cast + prior settled run (synthetic, labelled)
│  └─ model-eval.ts                 [P3] run the policy fixture through the real pipeline on chosen OpenRouter models, N times
│
├─ src/
│  ├─ proxy.ts                      [P2] Next 16 proxy (was middleware): session refresh, redirects only; not authorization (excludes receipt + Circle webhook). [W] site lockdown: SITE_MODE allowlist, secret ADMIN_PATH rewrite + gate header
│  ├─ core/                         pure domain, no I/O
│  │  ├─ money/                     [P1] micro-USDC type, decimal ops, half-up rounding
│  │  ├─ domain/                    [P2] entities; run/config/exception/obligation/batch/payment state machines (compare-and-set)
│  │  ├─ ports/                     [P1] repositories, AiProvider, PaymentRail, ChainReader, Clock, Ids; EmploymentEvidenceSource, AccountingDestination, DocumentSource, Notifier [Next]
│  │  ├─ config/                    [P2] rule catalog, pay types, policy clauses, config versioning + lifecycle; rule scopes, categories, precedence, overrides, clash + duplicate checks [P4c]
│  │  ├─ engine/                    [P1] calculatePayroll, trace lines, calculation hash (full in P2)
│  │  ├─ validation/                [P3] schema, semantic, evidence validators; invariant checks (plan checks in P4b)
│  │  ├─ ai/                        [P3] AI interfaces, validate-repair pipeline, prompts
│  │  │  └─ inputs/                 [P3] strict input schemas + builders: the only way data reaches a prompt
│  │  ├─ ingest/                    [P3] mapping, normalization, USD check, duplicate detection, name-key file encryption (browser anonymiser shares its types); documents.ts clause splitting + xlsx value rules [P4c]
│  │  ├─ integrations/              [P3] capabilities, categories, provider descriptors (csv_upload), requireCapability, provenance schema; connection lifecycle [Next]; never names a vendor
│  │  ├─ reconciliation/            [P3] deterministic checks, exception creation, AI classification intake
│  │  ├─ variance/                  [P3] actual-paid vs engine comparison
│  │  ├─ views/                     [P3] table view definitions: per-table column/operator allow-lists, validation, totals, CSV escaping for exports (docs/pages.md §5)
│  │  ├─ workflow/                  [P2] run service, approvals, four-eyes (extended in P4)
│  │  ├─ payments/                  [P1] obligations, gate.ts (single gate, issues the gate pass), payment agent, retry, settlement matching (full in P4)
│  │  │  ├─ batches/                [P4] batch lifecycle, plan hash, fallback plan, holds, standing authorization
│  │  │  ├─ signals/                [P4] deterministic payment signals
│  │  │  └─ planner/                [P4b] PaymentPlanner intake + validation
│  │  ├─ audit/                     [P2] audit event builder, correlation IDs
│  │  ├─ tenancy/                   [P3b] roles (several per member), permission checks, the last-Owner rule
│  │  ├─ invites/                   [P3b] invite status, 7-day expiry, which roles need re-auth, the one generic reply
│  │  ├─ company/                   [P3b] company profile schemas (basics, pay schedule), country and time-zone lists
│  │  ├─ setup/                     [P3b] dashboard setup checklist, computed from facts
│  │  └─ growth/                    [W] waitlist + lead list: enums/labels, request schemas, lead actions, metrics, CSV escaping
│  │
│  ├─ server/                       adapters implementing core ports
│  │  ├─ env.ts                     [P0] Zod-validated server env
│  │  ├─ log.ts                     [P1] redacting logger (never raw SDK errors)
│  │  ├─ site.ts                    [W] SITE_MODE (fail closed to waitlist), ADMIN_PATH, admin gate header check
│  │  ├─ crypto/                    [P2] field encryption: AES-256-GCM, per-company data keys wrapped by DATA_ENCRYPTION_KEY; called only by db/
│  │  ├─ db/                        [P1] Supabase clients (user-scoped for reads; service role for all writes), repositories that set company_id from context
│  │  ├─ auth/                      [P2] session, auth guard for every handler, company + roles from `memberships`, signed active-company cookie (`company.ts`), invite acceptance (`invite.ts`), re-auth (password in same request)
│  │  ├─ email/                     [P3b] invite emails through Resend when RESEND_API_KEY is set (link only otherwise)
│  │  ├─ x402/                      [P4] Kleeno Verify: 402 requirements, Gateway facilitator settlement, response allow-list
│  │  ├─ ai/                        [P3] openrouter.ts adapter (structured output, privacy flags, model fallback), provider.ts (model + fallback from config), policy.ts (policy text -> AIExecution -> config in HUMAN_REVIEW)
│  │  ├─ circle/                    [P1] wallets client, provisioning (server job after live approval [P4]), guard-owner.ts (only openRun/closeRun/replaceOperator caller), webhook signature verification, gateway.ts top-up to the company's own approver wallet [P4]
│  │  ├─ arc/                       [P1] viem reader: receipts, ObligationPaid + USDC Transfer logs, isPaid; guard ABI
│  │  ├─ rails/arc-usdc-rail.ts     [P1] PaymentRail via PayrollGuard.pay
│  │  ├─ integrations/<provider>/   [Next] connectors, one folder per vendor (the only place vendor code lives)
│  │  └─ mcp/                       [Next] read-only Kleeno MCP tool handlers (docs/integrations/mcp.md)
│  │
│  ├─ app/                          Next.js App Router
│  │  ├─ (public)/                  [W] public pages + Vercel Web Analytics: page.tsx landing + waitlist (docs/pages.md §3), privacy/ data note
│  │  ├─ (app)/                     [W] route group for every payroll page below; its layout returns 404 while SITE_MODE is waitlist
│  │  ├─ admin/                     [W] private lead list, served only via /<ADMIN_PATH> (login + MFA, list + metrics, contacts/[id])
│  │  ├─ not-found.tsx, robots.ts, sitemap.ts, opengraph-image.tsx, icon.svg   [W] one 404 for everything; SEO files (public pages only)
│  │  ├─ login/                     [P2] Supabase auth (sign-up disabled), MFA challenge
│  │  ├─ invite/[token]/            [P3b] accept an invite: create account or sign in, join company
│  │  ├─ onboarding/                [P3b] 3-screen wizard: account security, company basics, pay schedule
│  │  ├─ settings/company/          [P3b] company details (Owner edits)
│  │  ├─ settings/team/             [P3b] members, roles, invites
│  │  ├─ account/                   [P2] password change, MFA enrolment
│  │  ├─ dashboard/                 [P1] crude in P1, setup checklist [P3b], full in P4d (docs/pages.md §6)
│  │  ├─ configuration/             [P3] policy entry, AI proposal, validation log, approval
│  │  ├─ workers/                   [P2] workers, pay types, wallets, recipient-change confirmation
│  │  ├─ import/                    [P3] in-browser parse + anonymise, column mapping, import results
│  │  ├─ exceptions/                [P3] evidence view, AI suggestion, resolution
│  │  ├─ runs/[runId]/              [P1] payroll review, trace, variance, approval (full in P4)
│  │  ├─ settlement/                [P4] payment plan, flags, holds, signing (re-auth), standing authorization, live payments OFF switch, status, reconciliation
│  │  ├─ audit/                     [P5] audit timeline
│  │  ├─ settings/integrations/     [Next] connection cards: status, capabilities, last sync, reauthorize, disconnect
│  │  ├─ receipt/[token]/           [P4] public read-only receipt (signed, expiring, noindex)
│  │  └─ api/                       [P1+] thin handlers (the only mutation surface; no Server Actions): config, imports, runs, exceptions, payments (incl. recover), circle/webhook; companies, invites, members, active-company [P3b]; live-payments, gateway, x402/verify (public, paid) [P4]; mcp [Next]; waitlist/ (public) + admin/ (gate + platform admin; access + live-payment approvals [P3b/P4]) [W]
│  │
│  └─ components/                   [P1+] shared UI (shadcn/ui); table-view/ [P3] reusable table view (`table-view.tsx`, server-driven by `core/views`; no TanStack), `record-tabs.tsx`, `import-wizard.tsx`, `exception-panels.tsx`, `config-forms.tsx`; company-switcher, setup-checklist [P3b]; policy-upload (browser PDF/Word/TXT/MD parsing), name reveal [P4c]; period-stepper, stat tiles, activity feed [P4d]
│
└─ tests/
   ├─ invariants/                   [P1+] PROTECTED: invariants + fixture acceptance (payment-plan in P4b); security/ structure + secrets checks [P0+]; gate, kill-switch, standing-auth, AI privacy/injection, webhook, failure + crash matrices; integrations/ (provenance, capabilities, snapshot isolation) [P3]
   ├─ fixtures/                     [P1+] PROTECTED: fixture data + expected results (synthetic, labelled); ai/ (policy, injection/) and reconciliation/ (six-worker demo cast) [P3]
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
- **P3b Company system** (Oct 3–4; `docs/phases/P3b.md`): memberships (replace `app_users`), active company + switcher, Owner + several roles, invites (platform + company; copy link, Resend email optional), admin access approvals, onboarding wizard, company settings, team page, setup checklist, sandbox companies. Security: S61–S65.
- **P4 Payments** (Oct 4–7, in parallel after P3b slice 1): full run flow, payroll approval + re-auth, recipient-change confirmation, obligations, signals, batches (fallback plan, holds, signing, plan hash), standing authorization, full gate, retry + crash recovery (fixtures), webhook verification, settlement reconciliation, receipt page, `live-payments.ts` + OFF switch; live-payments request → admin approval → provisioning job → Owner ON (re-auth + TOTP); Gateway top-up; Kleeno Verify (x402). Security: S05–S09 full, S16, S27–S31, S33, S36 limits, S66–S68.
- **P4b Payment Planner** (Oct 7, can be cut): PaymentPlanner, plan validation + protected payment-plan invariant, flags/holds/rationale in the settlement UI. Security: S21–S23 for the planner.
- **P4c Policy + pay** (Oct 5–6): policy documents read in the browser, Excel import, rule scopes + categories + precedence + overrides, worker tags and profile fields, duplicate/clash warnings, AI proposal cache, pay additions, fixed deductions, part-period pay, names shown from the key file. Security: S69–S73, S42 extended.
- **P4d Dashboard + motion** (Oct 6–7): period stepper, tiles, to-dos, AI activity feed, runs table, per-worker history, motion tokens (`DESIGN.md` §10). No new security rows (read-only views through existing repositories).
- **W Waitlist** (side phase, Oct 1): `growth` schema (server-only), public landing + waitlist + survey, `/privacy`, site lockdown (`SITE_MODE`), secret admin lead list with MFA, CSV export, SEO files, Vercel Web Analytics. Security: S51–S58. Spec: `docs/phases/W.md`.
- **P5 Demo + submission** (Oct 8–10, feature freeze): audit timeline, e2e smoke, demo company + seed + rate limits, model eval, backend `ponytail-audit` + `ponytail-debt`, README, traction, demo script, `demo-freeze` tag, DB backup, deploy, going-public checklist + hosting checks (`docs/github.md` §5–6), video, submit. Landing page (`docs/pages.md`). Security: S36 rate limits, gitleaks full history before the repo goes public, final status in `docs/security.md` §6.
