# Kleeno — Product Requirements

Tameion Agents Hackathon (Canteen × Arc), Sep 27 – Oct 10 2026; submission by 11:59 PM ET Oct 10. Track 4 Autonomous Business Operator (touches Track 2 reconciliation). Track 4 needs "at least one complete business workflow, run by the agent from start to finish".

## 1. Problem
Small businesses pay their teams (employees and remote contractors) from messy spreadsheets. Errors (missed or unapproved extra hours, wrongly deducted leave, duplicate timesheets, wrong recipient) are found late or never. "Autonomous" AI payroll is unsafe: models guess numbers, and a balanced ledger does not catch omissions or wrong-party payments.

## 2. Goal
Controlled automation: AI turns policy and messy data into validated, human-approved payroll. Deterministic code calculates. An AI planner proposes how to pay; a human signs (or a standing rule signs clean batches). USDC settles on Arc testnet through a payment agent that the contract limits to the approved obligations. Every payment is independently reconciled and audited.

## 3. Market and users
- **Market**: global by design; each company configures its own rules through the AI config. First market (tentative): US firms paying remote contractors in USDC.
- **Platform admin** (the user): approves access requests from the waitlist and each company's first live payments.
- **Owner**: creates the company from an approved invite, edits company details, invites the team and assigns roles. A member may hold several roles; one login may belong to many companies (workspaces).
- **HR approver**: enters policy, approves config, imports data, resolves exceptions, approves payroll.
- **Payment approver**: reviews the payment plan and signs batches (must differ from the payroll approver); releases holds; sets the standing authorization and the per-payment ceiling; confirms recipient changes.
- **Worker** (employee or contractor; pay type SALARIED, HOURLY or RETAINER): receives testnet USDC in a company-managed wallet; views a read-only receipt page (amount, tx hash, arcscan link).
- **Pilot companies** (traction): real teams with written consent; data anonymised in the browser before upload; deleted on request.
- **Judges**: shared logins on a separate demo company where live payments are disabled, plus an optional invite that creates their own sandbox company (SIMULATION only).

## 4. Run modes
- **SIMULATION** (default): full pipeline to validated calculation, plus a variance report against what the business actually paid. Payment impossible.
- **LIVE_TESTNET**: continues to approval, obligations, payment plan, authorization, guarded USDC payment on Arc testnet and settlement reconciliation. Amounts are never scaled; if funds are short, payment is blocked.

## 5. Scope
In scope (demo path):
- Policy text -> AI rules -> validation + bounded repair -> HR approval (versioned config). Rules: base salary, hourly rate, fixed retainer, extra hours/overtime, paid/unpaid leave, flat-percentage deductions.
- CSV import in USD only: in-browser anonymisation, column mapping, duplicate detection.
- Reconciliation with 4 exception types (unexplained missing hours, duplicate timesheet, unapproved overtime, leave/work conflict) and human resolution.
- Deterministic engine with calculation trace; USDC 6-dp money.
- Payroll approval, then separate payment authorization (two roles, four-eyes).
- Variance report (SIMULATION).
- Payment batches; Payment Planner (order, hold, flag, explain); standing authorization for clean batches.
- Circle dev-controlled wallets (approver, agent, one per worker), PayrollGuard contract, idempotent USDC payment, crash recovery, settlement reconciliation from Arc receipts.
- Audit timeline; worker receipt page; dashboard.
- Table views for record lists (`docs/pages.md` §5): columns, filters, sort, match status with auto-match count, bulk resolve with a note, row side panel, totals row, CSV export of the view; AI proposes view definitions only.
- Integration-ready foundation: every imported record carries provenance; capability-based source registry with the CSV upload as the first source. No connectors in the MVP (`docs/integrations/`).
- **Company system (P3b, user 2026-10-02):** invite-approved sign-up, company profile (name, country, time zone, size, industry, pay schedule), one login in many companies with a switcher, Owner role and several roles per member, team invites (copy link; email when Resend is set), 3-screen onboarding wizard, setup checklist, judge sandbox companies.
- **Payments add-ons (P4, user 2026-10-02):** live-payments request → platform approval → automatic wallets + guard → Owner switch ON (re-auth + TOTP); payroll top-up from another testnet chain through Circle Gateway; Kleeno Verify, a read-only x402 API that agents pay per call (testnet).
- **Policy and pay (P4c, user 2026-10-02):** policy documents (PDF, Word, TXT, Markdown) read in the browser into clauses; Excel import; rule scopes with derived categories (company, group, multi-group, personal), most specific wins with HR-confirmed overrides, groups = fields + custom tags; duplicate and clash warnings (rule check + text match); per-company cache of AI proposals; bonuses, commissions, reimbursements, fixed deductions, part-period pay; worker job title, department, type, tags, start date; names shown in the browser from the key file.
- **Dashboard and motion (P4d):** period stepper, number tiles, to-dos, AI activity feed, per-worker history, functional motion (`docs/pages.md` §6, `DESIGN.md` §10).

Out of scope (see `docs/roadmap.md`): FX/non-USD imports, market presets, allowances, holiday rules, leave balances, custom roles, open sign-up, legal entity details + tax ID, company logo, worker tables from PDF/Word, AI embeddings, x402 buying and per-run pricing, PDF payslips, rich reporting, jurisdiction tax packs, fiat/mobile-money rails, mainnet, CCTP/Paymaster, Gateway beyond payroll top-up, on-chain payroll data, tokenomics, unrestricted autonomous agents, HR/payroll/accounting/expense/document/notification/SSO connectors, the Kleeno MCP server, accounting journal export (all designed in `docs/integrations/`).

## 6. Screens
17 pages; purpose, audience and intended feeling per page in `docs/pages.md`. Landing · Privacy & security note · Login (MFA for real companies) · Invite acceptance · Onboarding wizard · Account · Dashboard (setup checklist, period stepper, tiles, to-dos, AI activity) · Configuration (documents, scopes, categories) · Workers & wallets · Import (CSV, Excel) · Exceptions · Payroll review (trace + variance) · Payment plan & settlement (batches, holds, flags, authorization, live-payments request and switch, Gateway top-up, status) · Audit timeline · Company settings · Team · Worker receipt (public, signed link). Plus the admin area's access requests and live-payment approvals.

## 7. Demo scenario (video < 3 min)
One run, 6 workers: W001 retainer (normal) · W002 hourly, 8 approved hours above cap (3× last run) · W003 salaried, 32 worked + 8 paid leave · W004 salaried, 36 worked, no leave · W005 hourly, duplicate timesheet · W006 salaried, leave/work conflict, recipient changed (confirmed).
1. Enter policy. 2. AI proposes rules. 3. Validation/repair loop visible. 4. HR approves config. 5. Import a messy CSV; names are stripped in the browser. 6. Exceptions flagged with evidence. 7. HR resolves. 8. Engine calculates with trace. 9. Invariants pass. 10. HR approves payroll. 11. Obligations created. 12. The Payment Planner proposes a batch: it holds W006 (recipient changed) and flags W002 (3× last run, explained by approved hours). 13. A different user signs the plan; the guard run opens with that exact set. 14. The payment agent pays via PayrollGuard. 15. Arc receipts matched to obligations. 16. The approver releases W006 in a second signed batch. 17. The audit timeline shows the full chain; a worker opens a receipt.
Also show: a clean next run paid under the standing authorization without a click; a SIMULATION run with variance findings; the guard rejecting a repeated or uncommitted obligation; a fresh company from invite to setup checklist; two policy documents where a personal contract overrides the handbook (HR confirms); a Gateway top-up of the payroll wallet; an agent paying $0.01 (testnet) through x402 to verify a receipt.

## 8. Acceptance criteria
1. Natural-language policy becomes a validated, versioned config using only catalog rules.
2. Invalid AI output is rejected; malformed output gets at most 2 repairs; repeated failure becomes a human exception.
3. HR approves config; runs reference an exact config version.
4. CSV import works for unknown layouts via column mapping; names never reach the server; non-USD files are rejected; duplicates are detected; re-import is idempotent.
5. Reconciliation detects the 4 MVP exception types with evidence; ambiguity becomes an exception.
6. Engine calculates SALARIED, HOURLY and RETAINER pay deterministically; the LLM never supplies amounts; same inputs reproduce the same hash.
7. Every amount has a trace; net = gross − deductions holds.
8. Failed validation blocks progression; open exceptions block calculation.
9. SIMULATION runs cannot create obligations or pay, and produce a variance report.
10. Obligations exist only after payroll approval, with stable idempotency keys.
11. Payment authorization (human or standing) requires a different user from the payroll approver, enforced in the database.
12. The payment plan contains every obligation exactly once with unchanged amounts and recipients; execution pays exactly the signed `plan_hash`; planner failure falls back to a deterministic plan.
13. Holds are released only by the payment approver; standing authorization never covers a batch with holds, signals, recipient changes or a fallback plan.
14. The gate blocks any mismatch; the payment agent cannot change amount or recipient.
15. PayrollGuard pays only obligations committed at `openRun`, each once, and only when called by the operator (Foundry tests).
16. Timeout, retry or a server crash mid-payment cannot double-pay or lose a payment.
17. Arc testnet USDC settlement is demonstrated and matched to obligations from the Arc receipt.
18. On-chain data is only net amounts, recipient addresses and hashed keys: no names, worker IDs or payroll detail.
19. Audit links policy -> data -> exception -> calculation -> approval -> obligation -> plan -> transaction.
20. The fixtures and invariants in `ARCHITECTURE.md` §20 run automatically in CI.
21. The system fails closed whenever correctness cannot be established.
22. Only authenticated members of a company see or act on its data; the public demo cannot move funds.
23. Switching live payments OFF stops every payment path at once (server and database). Turning it back ON needs a platform-approved company and the Owner with re-auth + TOTP (or the admin script); demo and sandbox companies never.
24. Every control in `docs/security.md` for a completed phase is verified by a test or named check, or reported as unverified with a reason.
25. Uploaded business data travels only over HTTPS and fields revealing pay or policy are encrypted at rest per company; real-company users sign in with MFA.
26. Every imported record states its source (provider, object, hash, import batch); a changed re-import never alters an approved calculation.
27. A business joins only through an approved invite; invite links are single-use, expire after 7 days and work only for the invited email.
28. One login can belong to several companies; every page, export and API call shows only the active company, and the server re-checks membership on every request.
29. The Owner manages company details and members; members can hold several roles; one person never approves payroll and authorizes payment for the same run.
30. Live payments start only after platform approval; wallets and the guard are then provisioned automatically and idempotently.
31. Policy documents (PDF, Word, TXT, Markdown) become clauses in the browser. Every rule has a scope and a derived category; the most specific wins only after HR confirms the override; same-level clashes block approval; unchanged clauses reuse the cached AI proposal.
32. Excel imports follow the in-browser CSV path; formulas are never evaluated.
33. Bonuses, commissions, reimbursements, fixed deductions and part-period pay are calculated deterministically, with trace lines and reasons.
34. Kleeno Verify answers paid x402 requests (testnet) with payment status only: no names, worker IDs or payroll detail.
35. A company can top up its Arc payroll wallet from another testnet chain through Gateway; Gateway never pays workers.

## 9. Judging alignment
- **Agentic sophistication (30%)**: policy interpreter, reconciliation agent and Payment Planner with schema-bound output, bounded repair, evidence checks; a capability-limited payment agent that runs clean batches end to end under a standing authorization.
- **Traction (30%)**: pilot companies' anonymised data in SIMULATION (variance findings) and small live testnet payrolls; record companies, workers paid, testnet USDC moved, variances found, testimonials.
- **Circle tools (20%)**: developer-controlled wallets (treasury, agent, per-worker), contract execution, webhooks, Gateway (payroll top-up across chains), x402 nanopayments (Kleeno Verify); optional contract event monitoring.
- **Innovation (20%)**: payroll correctness, payment planning, authorization and on-chain verification kept separate; the contract, not prompts, limits the agent to the exact approved obligations; a human signs above the standing threshold; integration-ready by design (capability-based sources with provenance, a read-only MCP specified).

## 10. Traction and data plan
Three trust levels for pilot companies:
1. **Shadow run (SIMULATION)**: they export last period's hours and amounts paid; the browser strips names and bank columns; Kleeno returns variance findings. Nothing is paid.
2. **Live testnet run**: a few workers (or people the user knows) get company-managed wallets and receive testnet USDC with receipt links.
3. **Deletion on request**, plus a one-page data note (what is kept, where, for how long).
Outreach and pilot tracking run as a separate task, outside the build phases. `docs/traction.md` records only real participants, labelled "Arc testnet, no real funds".

## 11. Submission checklist
Public GitHub repo (going-public checklist in `docs/github.md` §5 passed; the user approves the switch) · video < 3 min on Loom/YouTube/Vimeo · live link (Vercel; judges log into the SIMULATION-only demo company) · traction summary in README and `docs/traction.md` · honest framing: Arc testnet, custodial wallets, no real payouts, net amounts are public on-chain · no name↔wallet mapping in any public material. Submitted via the official form.

## 12. Timeline and cuts
- Done: P0 Sep 29–30 · P1 Sep 30 · P2 Sep 30–Oct 1 · W waitlist Oct 1 · P3 Oct 2 (two days early).
- Update (user, 2026-10-03): P4u App shell + product UI (sidebar, top bar; `docs/phases/P4u.md`) Oct 3–4, on `p4-payments` before the P4 browser check · P4g Google sign-in (`docs/phases/P4g.md`) straight after P4 merges, ~Oct 4–5; later phases shift by up to a day. Landing/waitlist and `/privacy` are redesigned last.
- Plan (user, 2026-10-02): P3b Company system: Oct 3–4 · P4 Payments (+ live activation, Gateway top-up, Kleeno Verify): Oct 4–7, in parallel after P3b's foundation slice · P4c Policy + pay: Oct 5–6 · P4d Dashboard + motion: Oct 6–7 · P4b Payment Planner: Oct 7 (can be cut) · Oct 8 feature freeze · P5 Demo + submission: Oct 8–10.
- Cut order if late (user, 2026-10-02): 1 motion polish → 2 Gateway top-up → 3 Kleeno Verify → 4 part-period pay → 5 Payment Planner (P4b) → 6 department and single-worker scopes → 7 receipt page → 8 Playwright beyond one smoke test → 9 standing authorization. Never cut: company system, invites, policy upload, dashboard, guard, gate, invariants, SIMULATION variance, settlement reconciliation, audit, kill switch, RLS + read-only public DB API.
- Minimum demo if P4/P5 fail: the full SIMULATION path in the UI plus the P1 scripted guarded payment on Arc with an arcscan link.
