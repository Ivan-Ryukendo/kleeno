# Kleeno — Product Requirements

Tameion Agents Hackathon (Canteen × Arc), starts Sep 27, 2026; extended submission deadline **Oct 17, 2026** (user update 2026-10-05). The updated cutoff time/timezone must be checked against the submission portal; the previous cutoff is not assumed. Track 4 Autonomous Business Operator (touches Track 2 reconciliation). Track 4 needs "at least one complete business workflow, run by the agent from start to finish".

## 1. Problem
Small businesses pay their teams (employees and remote contractors) from messy spreadsheets. Errors (missed or unapproved extra hours, wrongly deducted leave, duplicate timesheets, wrong recipient) are found late or never. "Autonomous" AI payroll is unsafe: models guess numbers, and a balanced ledger does not catch omissions or wrong-party payments.

## 2. Goal
Controlled automation: AI turns policy and messy data into validated, human-approved payroll. Deterministic code calculates. An AI planner proposes how to pay; a human signs (or a standing rule signs clean batches). USDC settles on Arc testnet through a payment agent that the contract limits to the approved obligations. Every payment is independently reconciled and audited.

**Kleeno — Verified Payroll Automation.** AI understands. Evidence grounds. Validation verifies. Humans govern. Deterministic code executes. Audit proves. The differentiation is the verifiable chain from policy/evidence/rule/data through exception, calculation hash, approval, obligation, payment and settlement. “AI payroll”, “AI + human approval” and “RAG-powered payroll” alone are insufficient positioning.

Evidence-Grounded AI makes consequential recommendations traceable to approved company sources and exact records. Controlled Learning retrieves finalized human-approved precedent and may propose new rules later; it never silently changes configuration or gives AI authority. Design and implementation specs: `docs/evidence-grounded-ai.md`. These additions are planned, not existing shipped capabilities.

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
- **Policy and pay (P4c):** browser extraction of approved document formats and Excel import; scoped rules, HR-confirmed overrides, duplicate/clash warnings, cached AI proposals, pay additions/deductions and part-period pay; worker metadata and browser-only name reveal. Owner-approved additions include company-configured leave with no preset entitlement, actual/target and weighted KPI performance, and reviewed/audited typed inputs; missing evidence remains Data required.
- **Dashboard and motion (P4d):** period stepper, number tiles, to-dos, AI activity feed, per-worker history, functional motion (`docs/pages.md` §6, `DESIGN.md` §10).
- **Evidence retrieval (P4r, owner-selected synthetic-first 2026-10-05; in progress):** a small approved policy-clause store, replaceable embedding provider evaluated at 768 versus 1536 dimensions, Supabase pgvector with tenant/version/effectivity predicates, exact + semantic and privacy-compatible lexical ranking, stable evidence IDs, citation/support validation in the existing AI pipeline and visible provenance in one exception workflow. Synthetic fixtures only until source/privacy decisions and provider data-use review permit real business data; an approved historical precedent demonstration is optional. Native code first, LangChain deferred. Spec: `docs/phases/P4r.md`.

Out of scope (see `docs/roadmap.md`): FX/non-USD imports, market presets, allowances, holiday rules, custom roles, open sign-up, legal entity details + tax ID, company logo, worker tables from PDF/Word, generic enterprise RAG, multimodal knowledge ingestion, continuous learning/fine-tuning, automatic rule changes, x402 buying and per-run pricing, PDF payslips, rich reporting, jurisdiction tax packs, fiat/mobile-money rails, mainnet, CCTP/Paymaster, Gateway beyond payroll top-up, on-chain payroll data, tokenomics, unrestricted autonomous agents, HR/payroll/accounting/expense/document/notification/SSO connectors, the Kleeno MCP server, accounting journal export (all designed in `docs/integrations/`). The narrow embedding/retrieval slice above is conditional MVP scope; broader embeddings remain roadmap.

## 6. Screens
17 pages; purpose, audience and intended feeling per page in `docs/pages.md`. Landing · Privacy & security note · Login (MFA for real companies) · Invite acceptance · Onboarding wizard · Account · Dashboard (setup checklist, period stepper, tiles, to-dos, AI activity) · Configuration (documents, scopes, categories) · Workers & wallets · Import (CSV, Excel) · Exceptions · Payroll review (trace + variance) · Payment plan & settlement (batches, holds, flags, authorization, live-payments request and switch, Gateway top-up, status) · Audit timeline · Company settings · Team · Worker receipt (public, signed link). Plus the admin area's access requests and live-payment approvals.

## 7. Demo scenario (video < 3 min)
One run, 6 workers: W001 retainer (normal) · W002 hourly, 8 approved hours above cap (3× last run) · W003 salaried, 32 worked + 8 paid leave · W004 salaried, 36 worked, no leave · W005 hourly, duplicate timesheet · W006 salaried, leave/work conflict, recipient changed (confirmed).
1. Enter policy. 2. AI proposes rules. 3. Validation/repair loop visible. 4. HR approves config. 5. Import a messy CSV; names are stripped in the browser. 6. Exceptions flagged with evidence. 7. HR resolves. 8. Engine calculates with trace. 9. Invariants pass. 10. HR approves payroll. 11. Obligations created. 12. The Payment Planner proposes a batch: it holds W006 (recipient changed) and flags W002 (3× last run, explained by approved hours). 13. A different user signs the plan; the guard run opens with that exact set. 14. The payment agent pays via PayrollGuard. 15. Arc receipts matched to obligations. 16. The approver releases W006 in a second signed batch. 17. The audit timeline shows the full chain; a worker opens a receipt.
Also show: a clean next run paid under the standing authorization without a click; a SIMULATION run with variance findings; the guard rejecting a repeated or uncommitted obligation; a fresh company from invite to setup checklist; two policy documents where a personal contract overrides the handbook (HR confirms); a Gateway top-up of the payroll wallet; an agent paying $0.01 (testnet) through x402 to verify a receipt.

If P4r passes: show why an existing exception was flagged, its approved policy clause/config version, exact timesheet/leave evidence, structured validation checks and a human decision before deterministic calculation. Prior approved cases are labelled precedent, never authority. W003 remains the existing **paid-leave** scenario; the proposed unpaid-leave example needs a separately selected fixture and the existing resolution enum, not a silent cast change. AI never supplies final money; provider/RAG failure preserves the base demo.

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
Updated 2026-10-05 for **October 17, 2026**. Historical completion dates do not move; targets depend on preceding phase checks, not automatic seven-day shifts. Extra time prioritizes validation, evidence grounding, testing and demo quality.

| Date | Milestone / dependency |
|---|---|
| Completed | P0/P1/P2 Sep 29–Oct 1; W waitlist Oct 1; P3 and P3b git commits Oct 2 (P3b phase log labels Oct 3); P4/P4u merged Oct 3; remaining live integration checks stay unverified |
| Oct 5 | P4g slice 1 real provider spike + user check and phase closure; slice 2 can be cut. External setup remains a dependency, not an assumed completed milestone |
| Oct 6–7 | P4c policy/pay; approved clause/config identities, parsing/scope/pay tests. Owner-approved phase spec is in progress |
| Oct 8 | P4d dashboard/read-only activity; begin P5 audit, fixture and demo readiness work |
| Oct 9 | P4b planner and standing authorization implementation; **core payroll/payment demo checkpoint**. Live execution remains gated by all existing controls and external readiness |
| Oct 10 | P4r checkpoint: core smoke stable, synthetic evaluation targets fixed; real-policy privacy/provider gate remains required before real data |
| Oct 10–12 | Selected synthetic-first P4r: interfaces, retrieval contracts, evidence validation, evaluation and one demo workflow; use synthetic fixtures until real-policy privacy/provider gates pass |
| Oct 12 | **Feature freeze and `demo-freeze` tag** after checks; unfinished features go to roadmap. After freeze, only phase-approved fixes; migrations additive only |
| Oct 13–14 | P5 protected regressions, retrieval and model evaluation, RLS/failure checks, SIMULATION + guarded testnet smoke; backup before planned Oct 14 deployment, rollback verification |
| Oct 15–16 | Rehearse and record video, truthful README/security/status, public-repo and hosting checks, submission dry run; aim to upload Oct 16 |
| Oct 17 | Final submission/portal confirmation; contingency fixes only. Verify precise organizer cutoff/timezone |

P4c and P4d implementation is in progress; P4r is selected synthetic-first after stable policy/config boundaries. P4b planner and standing authorization are selected and in progress; execution remains gated by existing controls and external readiness. P5 readiness begins early and owns validation after freeze. The existing approved parallel-phase exception remains available but does not authorize parallel infrastructure or presumed completion.
Current evidence, remaining verification and owners: `docs/p4-p5-readiness.md`. Draft P5 implementation/acceptance plan: `docs/phases/P5.md`; preparation can begin now, final release gates wait for the stable retained demo.
- Cut order if late (user, 2026-10-02): 1 motion polish → 2 Gateway top-up → 3 Kleeno Verify → 4 part-period pay → 5 Payment Planner (P4b) → 6 department and single-worker scopes → 7 receipt page → 8 Playwright beyond one smoke test → 9 standing authorization. Never cut: company system, invites, policy upload, dashboard, guard, gate, invariants, SIMULATION variance, settlement reconciliation, audit, kill switch, RLS + read-only public DB API.
- New scope cuts: prior-case demo first, then retrieval optimizations; defer P4r beyond synthetic fixtures if its entry gate or Oct 12 freeze cannot be met safely. Preserve the original core cut order and all protected controls.
- Minimum demo if P4/P5 fail: the full SIMULATION path in the UI plus the P1 scripted guarded payment on Arc with an arcscan link.

## 13. Evidence/learning acceptance (conditional P4r)

- Recommendations cite only supplied stable evidence; company, source/clause/version, approved status, effective period, pinned config and exact run/worker records validate before acceptance. Unsupported/conflicting/incomplete evidence → NEEDS_HUMAN_REVIEW.
- Protected fixture evaluation reports Recall@K and latency for both dimensions; tenant-isolation failures, disallowed version overrides and unsupported accepted claims are zero; required missing/conflict cases escalate 100%.
- UI exposes structured evidence/checks/decision/outcome through AIExecution/audit, not similarity-as-correctness or chain-of-thought.
- Only finalized human-approved precedent is eligible; rejected AI outputs never gain trust. Learning cannot change approved config or model weights; new automation rules require explicit human approval as immutable versions.
- Existing deterministic money/hash, four-eyes, immutable obligations, one payment gate, PayrollGuard, independent settlement, audit and SIMULATION invariants remain intact; embedding/model failure does not break their demo.

## 14. Future commercial product (2026-10-06; planned)

This section records approved future direction, not additional October 17 requirements or a claim of shipped capabilities. Current MVP scope/modes/acceptance/timeline above remain in force. The [ordered roadmap](docs/roadmap.md#future-product-delivery-sequence-approved-direction-2026-10-06) is the implementation backlog; current readiness remains in PROGRESS and the P4/P5 readiness inventory.

### Product goals and release boundaries

1. Current hackathon product: verified payroll automation in SIMULATION and guarded Arc LIVE_TESTNET under existing controls.
2. First commercial product: a payroll review and financial-records workspace alongside the customer's existing payroll/tax provider. Reduce HR review effort while making every amount, exception and policy explainable.
3. Later full United States payroll service: separately selected providers, worker types, jurisdictions, tax responsibilities and production launch gates. This is not an extension automatically unlocked by billing.

Pilot discovery establishes the initial commercial customer segment and measurable baseline. Record review time per period, unresolved exceptions, reconciled results, correction turnaround and support effort; agree target improvements before evaluating the pilot. No invented customer research or synthetic traction.

### Future user journeys

| User | Journey and expected outcome |
|---|---|
| HR/reviewer | Import supported data, inspect validation/policy applicability, resolve exceptions, inspect calculations, sign off review and export evidence. A correction references the original without altering approved history. |
| Company owner | Invite authorized reviewers, configure approved policies, view readiness and spending, opt into eligible profile storage and explicitly purchase service. Company roles never grant platform privileges. |
| Employee | After the separate access phase, see only their own published records, schedule/projects and supported performance measures; submit reviewed corrections. No direct approved-pay or recipient mutation. |
| Platform support | Diagnose a ticket through scoped metadata and deliberately submitted evidence; separate customer replies/internal notes and record actions. No unrestricted impersonation or payment powers. |
| Prospect | Book walkthrough, receive a prepared 48-hour demo at activation, understand expiry/export terms, explicitly subscribe if desired. Demo cannot pay and does not auto-convert. |

### Required future experience

Primary navigation: Dashboard, Payroll, All Workers; secondary Settings/Help. Login puts email/password before Google while preserving invitations and MFA. Dashboard separates planned and settled totals, spending trends/breakdowns and readiness; stale/missing data is labeled.

Payroll offers Table / Workflow / Payments / Activity from the same authoritative records. Table comments, views, context actions and source/formula inspection have keyboard/touch alternatives. Computed values are read-only; absent evidence is Data required. AI proposes only supported typed columns/formulas with human preview/approval.

Workflow option A is an inspectable read-only node diagram with a step-list alternative, not a configurable execution engine. Nodes show actual state, counts, evidence and permitted next actions.

Policies use baseline plus explicit per-setting overrides, source/version/effectivity and impact preview. Personal ordinarily outranks group/company; explicit HR priority can change this with a reason and approval. A one-person group remains a group; personal agreement is not upload recency. Equal-priority conflicts block affected approval. Preserve old configurations and approved history.

Employee profile storage is opt-in encrypted names/basic contact only initially, off by default for existing companies. HR plus employees viewing their own records is the proposed initial access default; broader manager access is deferred. Performance shows source, period, target, freshness and role/leave/workload context, never automatic punitive employment decisions.

### Admin, support and commercial requirements

Existing protected admin is a foundation for leads/access/live-testnet requests. Its current Sign-ups metric means waitlist contacts, not registered accounts. Extend it with Overview, Companies & Accounts, Support, Operations, Billing & Trials and existing Leads.

Count unique authentication users separately from companies, memberships, workers, invitations and leads. Deduplicate users across companies; exclude marked test/demo records from commercial metrics. Derive billing and operational status from authoritative server/provider facts.

Support requests carry tenant/requester, category/severity, status/assignee, correlation ID and history. Safe operational actions use existing services; support has no direct database or salary/recipient editing.

Stripe starts in test mode. Pricing is a hypothesis: $49/company/month plus $2 per unique worker reviewed that month, counted once across reruns; necessary reviewer accounts included. Define the precise usage event/timezone and validate costs before billing. Business registration and provider activation remain external prerequisites. Demo lasts 48 hours from prepared-workspace activation, no card or automatic conversion.

### Future acceptance scenarios (not yet verified)

| Area | Pass condition |
|---|---|
| Navigation/table/workflow | Existing critical actions remain reachable; keyboard/touch/screen-reader journeys work; table, graph and activity agree; every computed amount opens reproducible evidence. |
| Policies | Personal/default/explicit-group priority, equal-priority conflict, one-person group and effective-date cases behave deterministically; old approved results reproduce unchanged. |
| Review/corrections | Sign-off binds the reviewed version; changed inputs require new review; correction/export retains original evidence; no payment authority or obligations are created. |
| Accounts/support | Multi-company user counted once; workers/leads not counted as users; demo/test exclusions reconcile; cross-tenant/internal-note/unauthorized action tests fail closed. |
| Employees | Opt-in/off and self-only access tests pass; PII absent from AI/logs/chain; correction requests cannot change payees or approved pay directly. |
| Billing/demo | Duplicate/out-of-order events and reruns cannot duplicate usage; cancellation/failure/expiry behave correctly; no automatic conversion or demo payments. |
| Connectivity/AI | Revoke/stale/wrong-tenant/version cases are rejected; unsupported claims escalate; approved calculations work without AI availability. |
| Commercial operations | Reconciled consenting pilot, security review, demonstrated restore/recovery, incident/support ownership, published data terms and business/provider readiness. |

Full US payroll needs a separate specification and acceptance suite for funding, tax/filing, recipients, production execution, returns and reconciliation. Retention/SLO/recovery numbers, named connectors and production providers are phase decisions, not silently chosen implementation defaults.

## 15. Public launch, segments and commercial acceptance (2026-10-06; planned)

The owner's goal is a public, sellable product for small and large businesses plus payroll bureaus/accounting firms. Keep this broad direction while delivering in gates: first a paid review workspace, then the complete connected HR workspace, then separately approved enterprise/production-payroll capabilities. The [public-launch coverage and acquisition plan](docs/roadmap.md#public-launch-and-commercial-growth-2026-10-06-documentation-only) maps every surface to its release.

- **Launch recommendation:** pilot with smaller companies and bureaus managing a few clients; interview larger firms concurrently. These are initial acquisition cohorts, not hard company-size limits. Enterprise requirements must be validated before making contractual promises.
- **Bureaus:** explicit delegated membership per client company, safe switching, tenant-isolated imports/exports/approvals and revocation. Do not convert a bureau user into a platform admin. Agree who pays before offering combined billing.
- **Public does not require open signup:** public marketing/pricing/demo/help can lead to invite-approved provisioning initially. Open signup remains a separate abuse/security decision.
- **Complete SaaS lifecycle:** recovery/MFA/session expiry, company onboarding and ownership, invites/offboarding, concurrent-edit safety, support, billing/invoices/cancellation/failure, notifications, export/retention/deletion, terms/privacy/security and incident handling all require acceptance. A polished dashboard alone is insufficient.
- **Release promises:** current testnet claims stay labeled. The review product complements existing payroll/tax providers; employee/API capabilities are unavailable until their phase passes. No vendor acquisition or monitoring product establishes compliance or payroll readiness.
- **Technology recommendation:** retain Supabase/Postgres; no Turso requirement. Evaluate managed Grafana Cloud for operational telemetry in Step 11, with privacy/cost/alert tests. See ARCHITECTURE section 28; neither tool is installed by this plan.
- **Adoption target:** proposed first milestone is 100 activated HR/payroll reviewer accounts, reported alongside activated companies, paid organizations, recurring revenue and retention. Activation is a supported import plus inspection of a traceable calculated result by an authorized reviewer in a non-test workspace; separate demo and paid cohorts. Workers/leads/visits are not activated users.
- **Go-to-market:** segment-specific discovery, a small consenting pilot, founder-led authorized outreach, useful reviewed content, partner introductions and selective launch channels. Paid experiments wait for tracking, conversion evidence and an owner-approved budget; no bulk publishing/outreach is authorized here.

Commercial launch acceptance includes all applicable roadmap paid-launch rows, reconciled pilot results, no unresolved critical/high-risk financial or tenant-access defects, registered/verified billing business, clear data terms, tested incident/restore procedures and named support ownership. Actual availability, recovery objectives, retention, billing grace/refund/tax rules and enterprise commitments are fixed in their phase specifications before implementation or sale. Do not invent proof, customers, conversion rates or delivery guarantees.
