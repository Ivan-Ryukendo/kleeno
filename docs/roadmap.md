# Roadmap

**October 6 documentation handoff:** the [future product delivery sequence](#future-product-delivery-sequence-approved-direction-2026-10-06) below is the ordered commercial backlog. Earlier Now / Next / Later entries are retained as the existing scope/capability inventory; they do not override the new sequence, narrowed profile scope or pre-commercial security gates.

Out-of-scope ideas land here only after the user approves them.

## Now — Hackathon MVP (by Oct 17, 2026)
Scope in `PRD.md` §5. Arc testnet USDC via `ArcUsdcRail`; SIMULATION + LIVE_TESTNET; pay types SALARIED, HOURLY, RETAINER; Payment Planner; standing authorization. First market (tentative): US firms paying remote contractors.
Added by the user on 2026-10-02: company system and workspaces (P3b); live-payments activation, Gateway top-up and Kleeno Verify via x402 (P4); policy documents, rule scopes and categories, Excel import, bonuses, commissions, reimbursements, fixed deductions, part-period pay (P4c); dashboard and motion (P4d).

User update 2026-10-05: **Kleeno — Verified Payroll Automation**. Evidence-Grounded AI extends existing controls; Controlled Learning creates proposals from finalized human-approved precedent, never new authority. Conditional P4r: approved text policy corpus, replaceable `gemini-embedding-2` provider (768 versus 1536 evaluated on Kleeno fixtures), Supabase pgvector, tenant/version/effectivity-scoped exact/semantic and privacy-compatible lexical retrieval, valid evidence IDs and visible provenance in one exception workflow. Prior-approved-case demonstration only if time permits. This is planned, not built; resolve encrypted-policy/searchable-vector privacy before implementation (`docs/evidence-grounded-ai.md`). Native adapters first; no LangChain requirement or separate vector service.

Dependency schedule: current P4g → P4c Oct 6–7 → P4d Oct 8 → optional P4b/core checkpoint Oct 9 → retrieval go/no-go Oct 10 → conditional P4r Oct 10–12 → feature freeze/demo-freeze Oct 12 → P5 validation/testing Oct 13–14 → demo/polish Oct 15–16 → submit Oct 17. Detailed dates/cuts: PRD §12. Extra days prioritize validation and demo quality, not a generic RAG rebuild.
Current completion/verification inventory and external owners: `p4-p5-readiness.md`; P5 preparation/acceptance draft: `phases/P5.md`. These documents do not make planned work implemented or grant release authorization.

## Next — Pilot hardening (weeks after the event)
- Lead list, after the waitlist (W): researched prospects table, interaction log, structured interview notes, funnel analytics beyond the W metrics, budget-by-role breakdown, launch/confirmation emails with unsubscribe links (needs an email provider), Cloudflare Turnstile if spam gets through
- Table views for every record list (Excel or Notion style: columns, filters, sort, group, saved views, AI-proposed view definitions); first version in P3 with match status, bulk resolve, side panel, totals and export, spec in `docs/pages.md` §5. Advanced next: inline edits as reviewed change requests, conditional highlighting, pivot and chart views, team-shared views, scheduled exports, keyboard navigation
- Close and reporting (gap review of Tabulera and Woodrow, 2026-10-02): period-end view (approved but unpaid, held, in transit, mismatched); run sign-off package (totals, exceptions + resolutions, approvals, tx hashes + receipt matches, journal lines); open items carried across runs until resolved; year-to-date totals and a year-end per-contractor summary; correction and off-cycle runs that reference the run they fix. Period-end view and sign-off package may move into P4/P5 if time allows (user decides)
- Worker profiles, leave ledger and long-term leave, worker self-service with HR-approved change requests, photo/document upload, leave reminders: proposed in `docs/decisions/ADR-worker-profiles.md` (an HR-only page and in-app reminders may fit the hackathon if time allows after P3)
- Pilot with first users (US firms paying remote contractors); real, consented data in `docs/traction.md`
- FX at import (non-USD sheets), with an approved rate
- Market presets: starting configs per country and worker type (e.g. US contractors)
- Allowances, holiday rules, leave balances; pay frequency per worker; year-to-date totals and the year-end 1099 contractor summary; correction and off-cycle runs (some overlap with "Close and reporting")
- Custom roles (full RBAC); open sign-up with spam protection; SSO
- Company legal details (legal name, address, tax ID encrypted, Owner-only) and logo
- Invite and notification emails beyond invites (Resend), once the domain mail is fixed
- Worker tables inside PDF or Word files (needs reliable table extraction in the browser)
- Knowledge hardening beyond the conditional P4r slice: reviewed real-data/provider terms, larger handbooks, source approval/revocation/effective-period UX, rebuild/deletion/retention coverage, measured ANN performance and SQL full-text only with an approved confidentiality design
- Controlled Learning: sanitized resolution projections with verified outcomes, human-reviewed pattern proposals, immutable approved rule versions; never silent policy mutation or unrestricted self-learning
- Agent Activity Record expanded from AIExecution/audit: evidence, policy/config versions, proposed actions, concrete validation, permission, human decision and outcome; no chain-of-thought or similarity-as-correctness
- Optional LangChain retriever/loading/evaluation adapter only when it measurably reduces complexity; core financial/approval/validation/payment controls remain independent
- x402 beyond Kleeno Verify: Kleeno's agents buying services with a price preview and hard caps; per-run or per-worker pricing paid through x402
- Payslip PDFs, reporting, variance analytics
- Wider model evaluation across open models
- First connector for the first pilot's HR/payroll system: read-only shadow run (actual paid + timesheets), with the connection model (`docs/integrations/`)
- Read-only Kleeno MCP server (`docs/integrations/mcp.md`)
- Accounting journal preview export (`docs/integrations/accounting.md`)

## Later — Product
- Global rollout market by market, each configured through the AI config
- Second `PaymentRail`: fiat/mobile-money payout via a licensed partner
- Jurisdiction rule packs (tax, pension) as approved, versioned configuration
- Other Circle services: CCTP, Paymaster, Gateway beyond payroll top-up
- Owner key held by the payment approver, not the server
- Security assurance (deferred list in `docs/security.md` §4): KMS/HSM, external immutable log sink, penetration test, SOC 2 / ISO 27001 mapping, incident-response runbook, backup restore drill, MFA for approvers, session policy
- Audit anchor: hash of approved artifacts on-chain (optional)
- Multimodal knowledge retrieval (PDF/images/audio) only after privacy, provenance and per-modality evaluation; no automatic model-weight training from customer decisions
- More integrations: accounting write (QuickBooks Online, Xero first), unified APIs (`docs/decisions/`), SSO (Google Workspace, Entra ID, Okta), Slack/Teams notifications, expense and document sources
- Mainnet readiness: security review, key management, compliance review

## Not planned
On-chain payroll data, tokenomics, unrestricted autonomous agents, unrestricted self-learning, automatic policy/config changes or customer-decision fine-tuning in the MVP.

## Principles
Direction (user, 2026-10-02): start simple for the hackathon, then grow into the most advanced payroll app that is still easy to use. Each new feature keeps the rules below.
Payroll core stays rail-agnostic and vendor-agnostic; external systems are evidence, never authority; AI proposes, deterministic code calculates, humans approve; fail closed.
AI understands. Evidence grounds. Validation verifies. Humans govern. Deterministic code executes. Audit proves. Knowledge memory, approved resolution memory and immutable operational history stay separate; none grants AI permissions.

## Future product delivery sequence (approved direction, 2026-10-06)

**Status: documented future work; implementation not started by this handoff.** This sequence is the ordering authority for the future commercial product. Earlier Now / Next / Later lists remain a capability inventory, not a commitment to implement every item or a replacement for current P4/P5 acceptance. Existing partial implementations must be verified and reused.

### Goals and release boundaries

Make HR preparation/review faster; make every amount explainable and reproducible; preserve human control over policies, access and approvals; give employees useful published records and corrections; provide accurate platform monitoring and safe support; establish a sustainable paid service.

| Release | Boundary and evidence required |
|---|---|
| Current hackathon product | Existing PRD scope; SIMULATION and guarded Arc LIVE_TESTNET only. Current financial/privacy controls remain active. |
| Commercial review workspace | Complement the customer's payroll/tax provider: prepare, reconcile, review, sign off and export financial records. Paid access does not authorize wage payments or establish statutory payroll compliance. |
| Full United States payroll service | Separate provider, jurisdiction, tax, legal, security and operations programme. Production approval is not implied by a subscription or a testnet receipt. |

Immediate scope is documentation only. No application/UI/schema changes, migrations, deployment, provider activation or production payment is authorized by this roadmap. Future phase implementation follows the existing phase approval process.

### Delivery method and dependencies

Steps are ordered priorities, not blanket instructions to execute all twelve. Step 1 is the next handoff; Steps 2-3 establish customer/design acceptance. Steps 4-6 depend on the accepted foundation and design; Step 7 reuses platform authorization and may be selected after Step 1 without employee self-service. Step 8 depends on correction/access controls; Step 9 depends on a defined reviewed-worker usage event and platform reporting; Step 10 depends on stable authorized records; Step 11 gates paid launch; Step 12 has a separate specification.

Each phase records its goal, exclusions, data/API changes, migration/compatibility impact, tests, deployment/rollback needs and owner review. Define acceptance examples before code, test, implement, refactor and record evidence. For interviews/design/exports, acceptance is a reviewable deliverable, not an invented passing code test. Never weaken protected tests.

### Step 1 — Verify the existing foundation

- **Type:** verification and external setup; repairs only through their approved scope.
- **Work:** reconcile current source/branch state with the readiness inventory; execute pending migration/database tests in an isolated disposable environment; verify authentication/MFA, deployed browser behavior and applicable provider flows. Preserve uncommitted work. Remote dev configuration is not a disposable test target.
- **Inputs:** [readiness inventory](p4-p5-readiness.md), [database acceptance handoff](p4-database-acceptance.md), PROGRESS and current phase specifications.
- **Done when:** every required capability is verified or explicitly blocked with dated evidence and an owner. Local tests, synthetic harnesses and historical receipts are not deployed/full-run proof.
- **Next-session boundary:** inspect and prepare the bounded verification phase first; cloud changes, deployments and financial actions retain their existing approval gates.

### Step 2 — Validate the first commercial use case

- **Type:** discovery and business decisions, not feature coding.
- **Work:** interview prospective HR/payroll teams about initial problems, workarounds, frequency, time spent, exceptions and desired outcomes. The discovery agent structures answers; sensitive salary files are unnecessary for interviews. Actual outreach requires explicit authorization.
- **Deliverable:** target customer and worker population, supported input types, present workflow, proposed review journey, pilot consent and measurement plan.
- **Done when:** the pilot brief defines baselines and measures review time, unresolved exceptions, reconciliation results and support effort. Choose numeric improvement targets from that baseline before the pilot; do not invent research or traction.

### Step 3 — Specify and validate the future UI

- **Type:** design specification and owner review before UI coding.
- **Work:** map existing functions into Dashboard, Payroll and All Workers; secondary Settings/Help. Email/password precedes Google sign-in. Keep permissions, invitations, MFA and deep links working.
- **Deliverable:** page/action map and key journeys, including loading, empty, error, stale-data, permission-denied and mobile states. Use existing Kleeno tokens and ui-ux-pro-max accessibility guidance.
- **Done when:** the owner reviews the journeys and every critical current function has an accessible destination. Keyboard, touch and screen-reader behavior is specified. No UI implementation occurs merely because this direction is recorded.

### Step 4 — Implement the table and workflow experience

- **Type:** code extending current tables, not a second table engine.
- **Work:** comments, saved views, visible contextual actions, source/formula inspection and approved typed AI column proposals. Computed outputs stay read-only; missing evidence is Data required. Right-click/hover actions have keyboard and touch alternatives.
- **Workflow:** option A, a read-only inspectable node view with state/counts/evidence/permitted next actions and an accessible step list. Table / Workflow / Payments / Activity share authoritative records.
- **Done when:** table, totals, graph and activity agree on amounts and status; each computed value reaches its source, rule/version, formula and intermediate values. SIMULATION does not display fictional payment progression.

### Step 5 — Extend policy management

- **Type:** versioned domain/UI changes with compatibility tests.
- **Work:** company baseline plus explicit overrides; groups/tags determine applicability. Resolve per setting/rule. Preserve current company, multi-group, group and personal behavior for existing configurations; personal normally outranks group/company. An individual agreement is a personal source, not a newest-upload-wins tier; a one-person group stays a group.
- **Configuration:** HR can explicitly rank a group above a personal rule with impact preview, recorded reason and authorized approval. Equal-priority conflicts block affected approval; embedding score and upload order confer no precedence.
- **Done when:** default/personal/intentional-group overrides, clashes, effective dates and historical reproduction pass tests. Explanations show applied, overridden and excluded rules with exact source clauses/versions. Later edits never rewrite approved records.

### Step 6 — Build commercial review and correction records

- **Type:** lifecycle specification followed by code.
- **Work:** separately specify commercial review sign-off, payroll cutoffs, owners, readiness, comparison of adjustments, correction requests and portable evidence packs. Bind review sign-off to immutable inputs/configuration/calculation.
- **Boundary:** review sign-off never creates a payment obligation or authorization. Do not extend SIMULATION's state machine silently. Corrections create new versions or adjustments referencing the original.
- **Done when:** HR can resolve exceptions, sign off a period, export reproducible evidence and trace a correction without rewriting approved history or acquiring payment authority.

### Step 7 — Extend platform administration and support

- **Type:** backend metrics, permissions and operational UI.
- **Current foundation:** protected admin has leads, access requests and live-testnet activation requests. Its Sign-ups metric counts waitlist contacts, not registered authentication accounts.
- **Work:** Overview; Companies & Accounts; Support; Operations; Billing & Trials; existing Leads. Report unique authentication accounts, companies, memberships, invitations, workers, leads, trials and subscriptions separately. One user in multiple companies counts once globally; workers without accounts are not users. Mark/exclude test/demo records from commercial metrics; define periods and freshness.
- **Support:** in-app requests with tenant/requester/category/severity/status/assignee/correlation ID/history, customer replies separate from internal notes. Initially access only operational metadata and deliberately submitted evidence; no unrestricted impersonation or direct database edits.
- **Operations:** job failures, stale syncs, validation failures, AI costs and unresolved provider outcomes; authorized safe actions through existing services. Platform support/billing/operations permissions do not derive from company roles and confer no payroll approval, recipient mutation or payment powers.
- **Done when:** metrics reconcile to backend/provider facts, duplicates and exclusions are tested, and unauthorized support access/mutations fail.

### Step 8 — Introduce employee profiles and self-service

- **Type:** security/identity specification, then code.
- **Work:** company opt-in encrypted employee names/basic contact details, default off for existing companies; employee-account mapping and self-only published information. Update rule 35/S25 and the profile ADR only when the guarded exception is implemented and verified.
- **Experience:** supported regular/irregular schedules with timezone, active projects/allocation/blockers, policies, correction requests and performance source/period/target/freshness. Missing information remains visible; role, leave and workload context matter. No automatic punitive employment decisions.
- **Default:** HR plus employees viewing their own records; wider manager access is deferred. Employee requests do not directly alter approved pay or recipients. Photos, general documents, medical records and broad profile notes are not included in the initial exception.
- **Done when:** self-only/tenant isolation, real-data MFA, opt-in/off behavior and sensitive-field exclusions from AI/logs/chain pass. Profile retention/deletion/export behavior is agreed and tested.

### Step 9 — Add subscriptions and the demo lifecycle

- **Type:** billing code plus business/provider setup.
- **Work:** Stripe test integration, signed/deduplicated webhooks, authoritative subscription status, usage, failed payments, cancellation and customer billing visibility. Record one billable worker per company/month despite reruns; precisely define the reviewed-worker event and billing-period timezone in this phase before coding.
- **Pricing hypothesis:** $49/company/month + $2 per unique worker reviewed that month; necessary reviewer accounts included. Validate provider/AI/storage/support costs; custom bureau/enterprise quoting is later commercial work.
- **Demo:** booked walkthrough, workspace prepared, then 48 hours from activation. No card, automatic conversion or real payroll payments. Define expiry, export and data lifecycle before launch.
- **Done when:** test-mode purchase/change/cancellation/failure, duplicate/out-of-order events, usage deduplication and demo expiry pass. Live collection additionally requires business registration (not yet completed), eligible verified provider account and activation. Billing never controls payment authorization.

### Step 10 — Expand connectivity and evidence retrieval

- **Type:** API/access specifications and scoped adapters.
- **Work:** documented read-only API/MCP plus validated existing-format imports/exports. Choose the first named HR/payroll/accounting connector from pilot demand; do not implement a generic connector marketplace.
- **Boundaries:** same membership/MFA/tenant/object checks; provenance, normalization, validation, reconciliation and immutable snapshots. External approvals are evidence only. No MCP/API tools for approval, recipient changes or payment execution.
- **Retrieval:** production embeddings require approved classification, provider data-use terms, searchable-storage protection, deletion and evaluation. Exact approved-source retrieval can serve the first release. Synthetic retrieval is not measured production embedding quality.
- **Done when:** revoked access, duplicate/stale imports, wrong-company/version evidence and unsupported accepted AI claims pass rejection tests; approved calculations remain usable when AI/retrieval is unavailable.

### Step 11 — Complete commercial operational readiness

- **Type:** reliability/security work, pilot evaluation and operational procedures.
- **Work:** monitoring and incident owners, bounded retries/exception queues, restore drills, interrupted-job recovery, retention/deletion/backup terms, support process, security review, capacity and cost testing. Define measurable availability, recovery-time and recovery-point objectives; distinguish platform and external-provider availability.
- **Controls:** independent settlement reconciliation, no blind retry on UNKNOWN, no automatic provider switching that risks duplicate payment; backup configuration alone is not recovery proof.
- **Done when:** consenting pilot results reconcile, security/access tests pass, restoration is demonstrated, support/incident owners are assigned, data terms are published and business/provider prerequisites are met. These are prerequisites for paid launch, not optional later polish. Never promise zero failures.

### Step 12 — Develop full United States payroll capability

- **Type:** separate discovery, commercial/legal/provider work, then a separately approved implementation programme.
- **Sequence:** select worker types/jurisdictions/responsibilities; evaluate licensed payroll/payment partners and contracts; define funding, cutoffs, tax, filing, corrections and reconciliation; specify production authorizations and recipient controls; test returns, duplicates, outages and unknown settlement; complete provider/legal/security/operational gates; launch a restricted cohort and expand using reconciliation evidence.
- **Done when:** a separately approved production specification passes its release gates. Testnet success and subscription billing are not production wage-payment readiness. Additional countries require their own validated scope.

### Checkpoints and future estimates

All planning dates below use Asia/Dhaka; the organizer's exact October 17 cutoff remains unconfirmed.

| Date (2026) | Checkpoint |
|---|---|
| October 9 | Current core readiness review |
| October 10 | Existing retrieval go/no-go |
| October 12 | Current feature/demo freeze |
| October 13-16 | Verification, fixes and rehearsal |
| October 17 | Submission subject to organizer cutoff |
| October 19 | Proposed commercial-roadmap prioritization review |
| October 30 | Proposed discovery and pilot-scope review |
| November 13 | Proposed pilot-readiness assessment |

Later dates are review targets, not feature-completion commitments. No reminders/automations are created. Estimate implementation after Step 1 and capacity review. Future UI/admin/support/billing/self-service work does not automatically enter the October 17 scope.

### Deferred choices and enhancements

Defer configurable/freeform workflow builders (options B/C), a separate graph database, broad custom roles/manager access, numerous connectors, additional jurisdictions and advanced people analytics until validated demand. Reuse existing database relationships for the graph.

Unresolved phase inputs: pilot customer/worker population and numeric targets (Step 2); detailed interaction review (Step 3); review lifecycle (Step 6); retention, deletion and employee rollout (Steps 8/11); billable event/timezone, demo data lifecycle and final pricing (Step 9); first connector and real embedding storage/provider (Step 10); operational SLO/RTO/RPO (Step 11); production partner/jurisdictions/tax responsibilities (Step 12). Resolve these in the relevant bounded phase spec, not silently during coding.

### Next-session handoff and status vocabulary

Read AGENT, project memory, PROGRESS, architecture and the selected phase. Documentation has now been recorded; check it for later changes rather than duplicating it. Next inspect actual source/deployment status, prepare Step 1's bounded verification specification, and use the existing phase review process. Do not execute the entire roadmap in one session.

Use **planned** for specified future work, **implemented** for code present, **verified** only for dated checks in the named environment, and **externally configured** for provider/business setup with independent evidence. A phase closes only after acceptance and required owner review; update progress, memory and security evidence then. This handoff does not upgrade any runtime status.

## Public launch and commercial growth (2026-10-06; documentation only)

The owner clarified that the destination is a public, sellable SaaS product, not only a hackathon submission. The twelve steps above remain the delivery order; this section makes launch coverage and go-to-market work explicit. A hackathon pass is neither a paid-launch gate nor evidence that these requirements are implemented.

### Source-of-truth ownership

| Source | Owns |
|---|---|
| This roadmap | Future ordering, dependencies, release coverage, customer acquisition and unresolved phase inputs |
| PRD future sections | Product capabilities, customers, user journeys and acceptance outcomes |
| ARCHITECTURE-ESSENTIALS active rules | Current non-negotiable behavior; future sections never silently override it |
| ARCHITECTURE future sections | Technical decisions and required activation/compatibility conditions |
| DESIGN and pages | Visual/interaction direction and all public/customer/admin journeys |
| Security plan | Control requirements, tests and honest evidence status |
| PROGRESS and project memory | Short resume point, dated decisions, verification facts and revocations |
| Selected phase specification | Exact implementation choices, tests, migration/rollout and exclusions before coding |

Use links rather than duplicate competing specifications. If a decision changes, date the replacement, update its owning document and affected references, and preserve historical evidence. No document should call a planned capability shipped.

### Customer segments and scaling direction

The owner wants small and large businesses plus payroll bureaus/accounting firms. Keep one product foundation with company workspaces, explicit memberships, reusable policy/review services and measured capacity. Product scalability does not prove enterprise readiness.

| Segment | Value proposition | Delivery gate |
|---|---|---|
| Small/growing businesses | Reduce spreadsheet review and explain policy exceptions before passing payroll to the existing provider. | First paid review-workspace acceptance. |
| Payroll bureaus/accounting firms | Repeat the controlled review across client companies without mixing data or approvals. | Bureau pilot: explicit delegated access, safe client switching, separate exports/periods, revoked access tests and a documented billing agreement. |
| Larger businesses | Traceable review, controlled access and repeatable evidence across complex teams. | Discovery can start early; enterprise sale requires agreed SSO/provisioning needs, security/procurement review, data terms, support commitments and tested workload capacity. |

Recommended initial acquisition cohorts are smaller companies and firms managing a few clients; this is a launch-sequencing recommendation, not a company-size restriction. Larger businesses can join discovery/design-partner discussions without promises that unbuilt enterprise features exist.

A bureau user may belong to multiple client companies, but every request retains an explicit active-company context. Do not give a bureau an unrestricted platform-admin role. Initially use existing workspace switching; any portfolio summary exposes only authorized aggregates and never merges client payroll records. Confirm whether the firm or each client buys the subscription before billing a bureau.

### Public-launch completeness matrix

All rows below are **planned or awaiting existing-capability verification**. Reuse existing code when present; this matrix does not label it newly missing.

| Area | Required work and acceptance | Roadmap step / gate |
|---|---|---|
| Positioning and public site | Clear review-workspace offer, supported scope, pricing explanation, demo booking, contact/help, security/privacy and terms; no claims of tax filing or real wage payment until supported. | 2/3/9/11, paid launch |
| Public account entry | Public request/demo flow leading to controlled provisioning. Retain invite-approved access initially; open self-service signup is a separate abuse/security decision. Pending, accepted, expired and rejected access have clear outcomes. | 3/7/9, paid launch |
| Authentication lifecycle | Email verification where required, login/logout, password reset, account recovery, MFA enrollment/recovery, session expiry/revocation and safe OAuth linking/redirects. Recovery never bypasses roles or financial re-auth. | 1/3/11, paid launch |
| Company/team lifecycle | Onboarding, current company, invitations/resend/revoke/expiry, role changes, last-owner protection, ownership transfer, departing-user access removal and activity history. Define guarded owner recovery before launch. | 1/7/11, paid launch |
| Bureau client handling | Explicit client/company identity in views/exports/actions; delegated membership, offboarding and tenant tests; billing buyer agreed. | 2/7/9, bureau launch |
| Import and data quality | Supported file limits/types, mapping preview, duplicates, malformed/partial imports, dates/timezones, currency rejection, provenance and recoverable errors. Never promise literally any data type. | 1/4/6, paid launch |
| Policy and review | Version/effectivity, per-rule overrides/conflicts, cutoff/owner, trace, approval invalidation, corrections and evidence export. Review status does not create obligations. | 5/6, paid launch |
| Concurrent changes | Detect stale edits/versions; avoid lost changes; preserve drafts only within approved privacy rules; show which version a reviewer approved. | 4/5/6, paid launch |
| Table/workflow/dashboard | Search/filter/order/views/comments, accessible inspection and same-state graph; planned versus settled totals and stale data explicit. | 3/4, paid launch |
| People/self-service | Opt-in encrypted identity, employee-account linkage, self-only published data, schedule/projects/metrics and reviewed corrections. Photos/general files remain later. | 8, complete HR workspace release |
| Subscription lifecycle | Checkout/activation, usage preview, invoices/receipts, billing owner, plan changes, cancellation, payment failure, duplicates, refunds/disputes and tax treatment as applicable. Define timing/proration/grace rules before coding. | 9, paid launch |
| Expiry and cancellation | Preserve authorized access to export/records during the published exit window; never delete approved records automatically when payment fails. Enforce agreed retention/legal obligations before deletion. | 9/11, paid launch |
| Notifications | Transactional invitations/security/support/billing notices, preferences, verified sender and delivery/bounce handling; counts and links only, no payroll content. Marketing opt-out is separate from essential service notices. | 7/9/11, paid launch |
| Admin and support | Correct account counts, scoped support roles, tickets/replies/internal notes, issue owner, safe operations, audit and support escalation. Suspend abusive access only through authorized audited controls. | 7, paid launch |
| API/connectors | Read-only access scopes, revocation/rotation, pagination/rate limits, errors/versioning, webhook validation where applicable and provenance. No arbitrary marketplace plugins or payment tools. | 10, complete connected workspace release |
| Privacy/legal | Business/provider readiness, reviewed terms/privacy/DPA/subprocessor information as applicable, data ownership/export, retention, deletion/backup expiry and jurisdiction review. Vendor certifications do not certify Kleeno. | 8/9/11, paid launch for enabled data/features |
| Environments/releases | Isolated development/staging/production credentials/data, reviewed migrations, deployment checks, rollback/forward-fix rehearsal, restricted previews, dependency/secret scans and release record. No preview with real payroll secrets/data. | 1/11, paid launch |
| Reliability | Service/error/latency monitoring, jobs/webhooks/AI failure queues, tested alert routing, incident runbooks, backups and restore/reconciliation evidence; provider outages handled explicitly. | 11, paid launch |
| Abuse and cost | Bound requests/uploads/AI retries and usage, enforce quotas safely, monitor spend and rate limits; cost controls cannot alter approved payroll or silently erase records. | 9/11, paid launch |
| Accessibility/performance | Keyboard, touch, screen-reader, zoom/reflow, contrast, reduced motion, browser coverage and representative workload tests. Review tables with real-size fixtures, not only six-worker samples. | 3/4/11, paid launch |
| Documentation/training | Customer setup guide, supported-format examples, policy/review explanations, correction/export guide, support contact/status and known limits; internally maintain runbooks. | 6/7/11, paid launch |
| Analytics and lifecycle | Privacy-minimized source attribution, activation, repeat use, paid conversion, churn reasons and support load; distinguish people/accounts/companies/customers. | 2/7/9/11, paid launch |
| Enterprise requirements | SSO/provisioning, finer roles, audit export, procurement, data residency/contracts and response commitments only as required by actual deals; capacity evidence before promising large-scale support. | Separate expansion spec after discovery |
| Production payroll | Approved partner/jurisdiction/tax/funding/filing/returns and independently reconciled production execution. | 12, separate payroll launch |

The first paid release must satisfy all applicable paid-launch rows. Employee/API expansion stays explicitly advertised as unavailable until its release gate passes; the full connected HR workspace includes Steps 8 and 10. Enterprise and full payroll have separate gates. Do not sell planned capabilities as present.

### Operational tooling: Grafana and Turso

Decision recommendation, researched October 6: keep Supabase/Postgres authoritative; do not add Turso for this launch. Evaluate managed Grafana Cloud in Step 11 for cross-service monitoring if it improves alerting beyond existing provider tooling. Monitoring and tested alerts are mandatory; a specific vendor is not. Technical evidence and adoption gates live in ARCHITECTURE section 28. No service purchase, credentials, installation or database migration is part of this documentation work.

### First 100 users: measurable acquisition programme

**Goal definition:** track 100 activated HR/payroll reviewer accounts as an initial adoption milestone, alongside unique activated companies, paying organizations, recurring revenue and retained use. An employee record, waitlist lead, synthetic account or website visit is not an activated reviewer. This is a planning target, not a forecast; revise it if the owner chooses a company-based target.

**Working budget assumption:** founder-led outreach/content first, no paid advertising commitment. A $0-$200/month acquisition ceiling is a proposed planning range pending the owner's budget answer, excluding hosting. No spending is authorized.

**Positioning:** "Kleeno helps HR and payroll teams review spreadsheet payroll, understand policy exceptions, and trace every calculated amount before they use their existing payroll provider." Adapt the language to the segment without claiming automatic tax compliance, production payment execution or guaranteed savings.

| Stage | Activities | Evidence / decision |
|---|---|---|
| Prepare | Define target segment/use case, publish accurate demo/pricing/security/help pages, set company email with SPF/DKIM/DMARC, establish booking and source attribution, prepare a short product walkthrough and sample evidence export. | Site and booking tested; sender verified; demonstration clearly separates simulation from real results. |
| Discover | Build an initial manually researched list of 30 relevant organizations across small companies and bureaus; interview willing contacts and invite suitable larger firms into discovery. Record business source/fit, pain point and permission/preferences. | Seek 10 useful conversations as an experiment target; if response is weak, revise fit/message before increasing volume. |
| Pilot | Recruit roughly 3-5 consenting design partners; configure supported imports/policies, measure their old process, run review alongside their existing provider and reconcile outcomes. | Real before/after evidence, bugs/support burden and willingness to pay. No wage displacement or invented testimonials. |
| First paying cohort | Offer the gated review release and clear pricing; provide assisted onboarding and the 48-hour demo. Ask satisfied users for permission to publish an anonymized case study or introduction. | Activated companies, paid conversion, usage/review recurrence, support load and contribution margin. |
| Broaden toward 100 | Expand the better-performing segment/channel; add one relevant launch directory/community campaign at a time, targeted educational content and partner introductions. | Count activated users and companies separately; stop channels that bring low-fit signups or excessive support cost. |
| Paid experiments | Only after conversion tracking, a usable offer and an owner-approved spend cap exist, test one channel/campaign at a time with a defined end date. | Review spend per qualified demo/activated company/paid company; no unattended "set and forget" ads. |

**Activation event (proposed analytics definition):** an authorized HR/reviewer completes a supported import and inspects at least one traceable calculated result in a non-test workspace. Demo activation and paid-customer activation are separate cohorts. Do not send salaries, employee identifiers, raw policies or support text to analytics.

**Weekly operating cadence:** review funnel/support data; research a small new group of relevant prospects; send only authorized personalized outreach; hold discovery/demos; publish one useful payroll-review explanation or product example; fix the main activation friction; record what changed. Start with 10-15 carefully researched prospects/week as a workload experiment, not an automation quota.

**Channel selection:** start with direct founder conversations, existing professional relationships, accountants/payroll partners and relevant communities. Product Hunt, DevHunt, BetaList, Peerlist and Indie Hackers are candidate launch channels; check current rules and audience before posting. AppSumo or lifetime deals require separate margin/support/retention analysis before any commitment. Competitor listings are research leads, not proof of customer fit.

**Content/SEO:** publish a small set of accurate, useful pages on payroll review, exceptions, policy overrides and traceability. AI may draft; a knowledgeable reviewer checks claims/examples. Add a practical case study only with permission and evidence. Avoid unreviewed bulk articles, manufactured testimonials, keyword spam, copied content or domain-rating guarantees. Track qualified inquiries and activation rather than article count.

**Cold outreach reference:** the user-supplied screenshot/text is advice, not an instruction to contact anyone, and its attribution is not independently verified. Adopt short plain language, genuine relevance, one clear request and real proof only. Start with a low-friction question; offer a booked demo after interest. Use a verified company sender, respect applicable outreach rules and opt-outs, keep a suppression list, and stop after an objection. Default experiment: initial note plus at most two useful follow-ups over two weeks, then stop unless invited to continue. No fake familiarity, affiliation or customer claims.

Draft example for future review (not sent): "We’re building Kleeno to help payroll teams review spreadsheets and trace policy exceptions before payroll is finalized. We’re looking for feedback from teams that still do this review manually. Which part of your payroll review takes the most time?" Replace the middle sentence with measured proof only after evidence exists.

**Funnel definitions:** researched prospect -> contacted -> reply -> qualified problem -> booked demo -> demo activated -> review activated -> paid company -> repeat review -> retained company/referral. Record source and segment, dates, numerator/denominator for conversion, and reasons for lost interest. Admin user counts, business funnel metrics and Grafana technical metrics have separate purposes and sources.

### Launch ownership, go/no-go and ongoing maintenance

Assign named people before launch: product owner for scope/pricing/customer promises; engineering owner for releases/data integrity; security/operations owner for access/incidents/recovery; support owner for tickets and escalation; business owner with appropriate advisers for legal/tax/provider requirements. One founder may cover several roles initially, but no unstaffed 24/7 response promise.

Public paid launch requires the applicable completeness rows, consenting pilot evidence, no unresolved critical/high-risk money or tenant-access defects, billing/provider/business setup, usable help and data terms, tested alerts/recovery, and explicit owner release approval. A calendar date never overrides this gate.

After launch: review alerts and failed jobs during declared coverage; triage support and reconcile billing regularly; review access/usage/cost and dependency updates; repeat recovery exercises and critical-path regression checks after material changes. Publish incident/status information through the agreed process, and track retention/churn as input to the next phase.

Before each phase starts, settle its listed open decisions with acceptance criteria. Completeness means every product surface has a home, owner and gate; it does not mean future provider/legal/enterprise choices have already been made.
