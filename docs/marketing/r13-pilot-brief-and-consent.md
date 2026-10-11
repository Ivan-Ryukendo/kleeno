# R13.1 - Pilot brief and consent template

Internal draft for owner review. Not approved for use, outreach or real-data onboarding. No partners, measured results, consent signatures or legal sign-off are recorded here. Complete the placeholders privately; never commit signed forms, contact details or payroll data.

## Pilot brief

**Purpose.** Test whether Kleeno helps reviewers understand inputs, resolve exceptions and trace calculations alongside their existing payroll provider. AI proposes, deterministic code calculates and people review. This pilot does not provide wage disbursement, tax filing, statutory compliance or an employer-of-record service. Demonstrate only verified features; identify planned work separately.

**Participants.** Select 3-5 consenting design partners from small companies and bureaus managing a few clients. The tentative first market is US firms paying remote contractors. Roughly 5-50 paid people is a recruitment hypothesis, not a verified capacity limit. Larger organisations remain discovery interviews. Each bureau client needs a separate company and explicit authorised membership; bureau access alone is insufficient.

**Partner scope sheet - fill before agreement**

| Field | Agreed value |
|---|---|
| Partner reference; authorised representative and reviewer roles | [private reference and roles; contacts kept separately] |
| Company or bureau/client scope | [one company per workspace; authority for each client confirmed] |
| Worker population | [count/range; employee/contractor mix; SALARIED/HOURLY/RETAINER as applicable] |
| Existing workflow and provider | [general steps, review owners and provider responsibilities] |
| Comparable periods and cutoff | [baseline period; pilot periods 1 and 2; frequency; cutoff and timezone] |
| Input format and fields | [approved USD CSV template/schema, supported limits, anonymised worker codes; synthetic sample checked first] |
| One downstream format | [versioned CSV schema, required fields, responsible recipient and acceptance check; separately verify current support] |
| Product version and verified functions | [release reference; supported import/review/calculation/export functions and limitations] |
| Mode | [SIMULATION review only; cannot pay] |
| Success targets and tolerances | [set jointly after baseline, before period 1; no invented target or guaranteed savings] |
| Support and weekly review | [named roles, private contact channel, agreed availability, weekly date; no 24/7 commitment] |
| Data-handling terms | [approved terms/version, storage/access, deletion and backup arrangements, incident contact] |
| Commercial terms | [owner-agreed pilot cost, if any; no automatic paid conversion or published pricing promise] |

**Entry gates.** Use synthetic SIMULATION data until onboarding is authorised. Real business data requires evidenced R12.9 and R9.10 completion, signed partner consent, baseline measurement (R13.2) and owner approval for R13.3. R12.9 must cover MFA for every user, encryption-key backup, privacy wording matching behaviour, agreed retention/deletion/backup terms, Vercel Pro and verified Supabase backups. A signed template does not satisfy those gates. Outreach separately requires RD.5 authorisation.

Names stay in the customer's browser under the existing name-key workflow; do not request the name key or upload worker names. Anonymisation does not make compensation or policy information non-confidential. Use only the agreed supported inputs and verified privacy controls; do not send source files, sensitive screenshots or private pilot records to this repository, marketing analytics or general-purpose AI tools. No discovery interview requests salary files; pilot imports are a separately gated product activity. Approved product AI inputs retain the existing strict input boundary; pilot consent cannot expand it.

**Working sequence.**

1. Owner selects partners and verifies company/client authority; complete scope and handling terms, obtain qualified review of the consent and relevant agreements, then record signed choices privately.
2. Measure the current process before Kleeno use. Agree comparable periods, metric start/stop points, population, success targets and reconciliation tolerance; capture evidence references without payroll values in research notes.
3. Confirm R12.9 and R9.10 evidence and owner onboarding approval. Begin with a synthetic sample to check the agreed input and downstream format. If a gate or required setting is missing, pause onboarding.
4. Run two comparable periods beside the existing provider. Kleeno SIMULATION cannot pay or create payment authority. The partner continues its usual checks, approvals and payroll execution with its provider; Kleeno results do not replace them.
5. Hold a weekly review; record exceptions and their owners, cutoff status, reconciliation differences, support effort and any scope/version changes. Pause on unauthorised data, access failures or unexplained discrepancies; contact the agreed owner/support role. Never retry or route payments through this pilot.
6. Compare results with the baseline. Record only consent-permitted anonymised summaries in docs/traction.md under R13.5; the owner decides go/no-go under R13.6. No automatic continuation, paid conversion, testimonial or public claim follows.

**Measurement sheet - one private sheet per partner**

| Metric | Definition and fields for baseline / period 1 / period 2 |
|---|---|
| Review time per period | Active reviewer minutes from first review to agreed cutoff/sign-off; sum across reviewers, record waiting time separately and use the same definition for all periods. |
| Time to first useful result | Elapsed time from agreed complete-input availability to the reviewer-confirmed first actionable finding or traceable result; agree what counts before measurement. |
| Unresolved exceptions at cutoff | Count still unresolved at the agreed local cutoff/timezone; record total exceptions and worker/input counts so periods can be compared. |
| Reconciliation | Matched/unmatched counts and whether the agreed totals/tolerance reconcile with provider evidence; distinguish review/export acknowledgement from verified settlement. Keep monetary details only in the approved private product/evidence store. |
| Correction turnaround | Elapsed time from recorded discrepancy to reviewed correction; record unresolved items and waiting time rather than inventing completion. |
| Support effort | Actual onboarding hours separately from support hours per period; include partner and Kleeno effort using the same boundary. |
| Willingness to pay | Voluntary stated willingness and conditions after the review; a statement is neither a purchase nor paid traction. |

Record period dates, product/configuration references, approximate population and any workload or process differences. Report unavailable measurements as unavailable. Calculate time change as baseline minutes minus pilot minutes; a percentage requires a nonzero comparable baseline. Do not attribute differences to Kleeno without considering workload changes. Numeric targets are agreed after baseline and are hypotheses to test.

## Pilot consent template - draft for qualified review

This template records proposed participation choices. It is not legal sign-off, a DPA or a substitute for reviewed Terms, Privacy, provider/data-processing arrangements or any company/client authority. Do not use while placeholders or applicable gates remain unresolved.

**Organiser / responsible organisation:** [legal name and approved contact]

**Partner reference and authorised representative:** [private reference; representative name, role and authority recorded privately]

**Client authority for a bureau:** [each participating client and documented authority, or not applicable]

**Agreement date, version and scope-sheet reference:** [date/version/reference]

**Approved Terms / Privacy / applicable data agreement:** [versions and private review reference]

**Questions, support, incident and withdrawal contacts:** [approved channels and responsible roles]

**Approved storage and people with access:** [locations; company/research/support roles; least-privilege arrangements]

**Pilot records and separate consent/contact records:** [categories, purposes and access boundaries]

**Retention/deletion dates and process:** [category-specific dates, deletion owner and request process]

**Backup retention and any required retained records:** [reviewed limits and explanation; no promise of instant erasure]

**Approved product providers / subprocessors and handling:** [reviewed list and terms references; unresolved means no real data]

**Period dates, mode and commercial terms:** [scope-sheet values; SIMULATION only; no automatic conversion]

Proposed participant-facing wording:

> We invite your organisation to a measured payroll-review pilot of Kleeno for the scope and periods agreed above. Participation is voluntary. Your authorised representative may decline, pause or end participation through the listed contact. We will explain any agreed closeout obligations and data-retention limits before you sign.
>
> We will first measure your current review process, then compare two agreed periods with Kleeno alongside your existing provider. We will discuss review time, exceptions, reconciliation, support effort and willingness to pay. We do not guarantee savings, accuracy, legal compliance, a particular feature or a launch date.
>
> Your organisation remains responsible for its payroll decisions, approvals and provider operation. Kleeno runs in SIMULATION for this pilot and cannot pay. You must continue your usual checks and use your existing provider for wages and required services. This agreement grants no payment authority and does not enrol you in a paid subscription.
>
> Before any real-data use, we must confirm the stated onboarding gates and approved data-handling agreements. Until then we use synthetic data only. Use the agreed supported inputs and worker codes; keep names and the name key in your own browser. Do not provide credentials, bank or wallet details, worker identity files or unsupported sensitive records. A general discovery interview does not require salary or payroll files.
>
> Only the authorised people described above may access pilot material for the stated purposes. Product data follows the reviewed product agreements and existing privacy boundaries; participation does not grant access to other companies or allow unrestricted AI use. Separate research notes contain process descriptions and measurements without worker identities or compensation details. Private records are not uploaded to the code repository, marketing analytics or general-purpose AI tools.
>
> We will keep and delete each category of material under the stated dates and arrangements. To stop participation or request deletion, use the listed contact and partner reference. We will explain any reviewed backup or required-retention limits and stop new pilot processing on withdrawal. We cannot promise removal of summaries that have already been irreversibly combined and cannot be linked to your organisation; do not publish such a summary without the permission below.
>
> Internal evaluation uses an anonymised partner reference and consent-permitted measurements. Publication of an anonymised case summary is a separate optional choice. Use of your organisation's name, logo or a testimonial requires separate written approval of the exact content. Declining publication does not prevent pilot participation. There is no audio, video or screen recording under this template; any such proposal requires separate reviewed permission.

Record each choice separately without preselected answers:

- Participation in the agreed measured pilot and necessary internal evaluation: **Agree / Do not agree**.
- Publication of an anonymised summary of agreed metrics: **Agree / Do not agree**; if agreed, record permitted fields, audience/channel and review/withdrawal conditions: [specific scope].
- One follow-up contact after the pilot: **Agree / Do not agree**; channel and purpose: [specific scope].

**Authorised partner representative:** [signature/approved acceptance method, date, authority reference]

**Organiser acceptance:** [responsible person, date]

**Qualified review reference:** [reviewer, date, version, outstanding changes]

**Private consent record reference:** [storage reference, choices, permitted uses, withdrawal status]

If participation is declined, do not onboard or collect pilot data. If publication is declined, keep results internal under the reviewed handling terms. Anonymised summaries can still identify a small company; check disclosure risk and the exact permitted use before publication. Never fabricate a signature, consent date, baseline, partner or result.

## Exact owner steps before completion or use

1. Review this brief and consent text and approve a dated version, or request specific changes. This approval is R13.1's Done-when; the agent cannot record it on the owner's behalf.
2. Before using the template, arrange qualified review of consent and applicable agreements; resolve every contact, authority, access, provider, retention, backup and withdrawal placeholder. This draft establishes none of those facts.
3. Select real partners privately and agree worker scope, formats, periods, support and commercial terms with them. Obtain their signed choices; a repository draft is not participant consent.
4. Record baseline sheets through R13.2, verify R12.9/R9.10 evidence and explicitly authorise R13.3 onboarding. Separately authorise RD.5 before outreach. No legal, onboarding or outreach step is marked done by this document.

Sources: [RD.3 interview and research consent](rd3-interview-script-and-consent.md), [product scope](../../PRD.md), [architecture rules](../../ARCHITECTURE-ESSENTIALS.md). Current R13/R12.9/RD.5 ledger and approved marketing scope live in HUB docs/roadmap.md and docs/marketing.md; those HUB references do not imply the files exist on this task branch.
