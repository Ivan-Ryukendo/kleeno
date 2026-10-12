# Route and action matrix

R9.1 draft for owner approval. Source baseline: integration `ff444b7`, inspected 2026-10-11. This records implemented destinations and authorization, not a new navigation design or proof of deployed behavior. Refresh the inventory when later tasks add routes.

## Reading the matrix

H = HR_APPROVER, P = PAYROLL_APPROVER, M = PAYMENT_APPROVER, O = OWNER, V = VIEWER. A role list means **any listed role**, not all. O is not a superuser: an Owner needs the separate reviewer role for financial data or payroll/payment actions. Company membership, active-company selection, object scope, applicable MFA, RLS and repository validation still apply to every company operation.

The [route guard](../src/server/auth/guard.ts), [session authentication](../src/server/auth/session.ts), [page session](../src/server/auth/page-session.ts) and [role checks](../src/core/tenancy/index.ts) are authoritative. In waitlist site mode, app-scope routes return 404. Admin scope requires the private path gate and platform-admin identity, password authentication and MFA, except the explicitly permitted login/MFA/logout steps. Company roles never grant platform-admin access.

**Both** means SIMULATION or LIVE_TESTNET evidence is supported subject to the run state and permissions. **Live only** describes the payroll/payment workflow; it grants no permission to call providers. SIMULATION ends at CALCULATION_VALIDATED and cannot create payroll approval, obligations or payments. Commercial review sign-off/export/acknowledgement is separate and grants no payment authority. These boundaries come from [state machines](../src/core/domain/machines.ts), [workflow](../src/core/workflow/index.ts) and [commercial review](../src/core/workflow/review.ts).

## Actions and their destinations

| Work | Destination to preserve | Who can act | Mode / conditions |
|---|---|---|---|
| Select an existing company | `/select-company`; POST `/api/companies/switch` | Signed-in member of target company | Company selection does not widen roles; verified factor still required |
| Company setup / team / invitations | `/onboarding`, `/settings/company`, `/settings/team` | O edits; authority-role grants require password re-auth | Company-level; new company starts simulation with payments OFF |
| Policy proposal and approval | `/configuration`; `/api/configs`, `/api/configs/[id]` | H or P | Company configuration state machine; approved versions immutable |
| Worker lifecycle, metadata and compensation | `/workers?worker=<id>`; worker API family | H or P; recipient confirmation M with password | Company-level; confirmed recipient and financial field visibility remain separate |
| Start a payroll period | `/dashboard#start-run`; POST `/api/runs` | H or P | Both; LIVE_TESTNET creation requires enabled live payments |
| Import anonymised USD evidence | `/import`; POST `/api/imports` | H or P | Both; frozen runs refuse edits |
| Reconcile or resume stranded reconciliation | `/runs/<id>`; `/api/runs/[id]/reconcile`, `/reconcile/retry` | H or P | Both; retry only RECONCILING, repository rechecks state |
| Resolve individual or bulk exceptions | `/exceptions?run=<id>` | H or P | Both; unresolved reconciliation exceptions block calculation |
| Adjust, calculate and inspect trace | `/runs/<id>`, `/runs/<id>#calculation-trace` | H or P edits/calculates; H/P/M financial readers | Both; reviewed inputs and pinned configuration determine hash |
| Readiness, tasks, thresholds, commercial handoff | `/runs/<id>#review-heading`, `/runs/<id>/workflow` | H or P writes; read permissions vary by endpoint below | Both; sign-off, export and recipient acknowledgement remain separate evidence |
| Propose an immutable correction | `/runs/<id>#review-heading`; corrections API | H or P | Separate correction evidence; replacement must be same-period, unsigned SIMULATION/CALCULATION_VALIDATED; never rewrite approved calculation |
| Submit, approve or reject payroll | `/runs/<id>` | H or P; approval requires password re-auth | Live only; PENDING_APPROVAL and calculation hash checked |
| Create obligations | `/runs/<id>`; `/api/runs/[id]/obligations` | H or P | Live only; approved payroll required |
| Plan, sign, open or execute batches | `/settlement?run=<id>` | M; signing requires password re-auth | Live only; four-eyes, live switch, plan hash and single payment gate remain mandatory |
| Close an open batch / discard a proposed batch | `/settlement?run=<id>` | M; no password re-auth | Existing live batch, state-scoped reduction of authority; remains available with live payments OFF |
| Standing authorization | `/settlement` | M; create needs password; revoke does not | Company-level live authority; only clean eligible batches can use it |
| Switch live payments OFF / ON | `/settlement`; `/api/company/live-payments` | OFF: O or M; request/ON: O; admin approval separate | ON requires password plus fresh TOTP, provisioning and distinct approvers; demo/sandbox never ON |
| Recover uncertain payments | `/settlement`; `/api/payments/recover` | O or M | Existing payment reconciliation; UNKNOWN never permits blind retry |
| Gateway own-wallet top-up | `/settlement`; Gateway API family | O or M; initial request needs password | Testnet own treasury only; never pays workers; provider verification still separate |
| Generate / read a receipt | `/settlement`; `/api/receipts`; `/receipt/<token>` | Creation guard listed below; signed token controls public read | Settlement proof required; allowlisted net amount, status and transaction proof only; no names, gross, deductions, traces or company |
| Activity and entity-linked evidence | `/audit?run=<id>&entity=<type>&before=<cursor>` | Member; financial details still role-filtered | Both; immutable references, not a new authority or state setter |
| Named views, table filtering/export and cell comments | Existing table destinations; `/api/tables/...`, `/api/views/...` | Membership at guard; repository/table/column and command permissions below | Company/run evidence; saved view or comment never changes authoritative payroll |
| Billing subscription and usage | `/settings/billing`; `/api/billing/...` | O | Stripe TEST only; subscription status grants no payroll/payment authority |
| Support ticket | `/support?ticket=<id>` | Member, scoped to accessible ticket | Submitted support evidence; no impersonation or financial authority |
| Platform operations | Private admin path; admin accounts/billing/support/contacts routes | Platform admin, not company O | Admin MFA/password gate; support metadata/submitted evidence only |
| Waitlist and survey | `/` and its waitlist/survey flow | Public validated, rate-limited submission | Waitlist scope; no company or payroll access |
| Read-only paid verification | GET `/api/x402/verify` | Payment protocol authorization, not company role | Read-only settlement verification; not a payroll payment rail |

## Deep-link behavior and review journeys

Keep dynamic IDs, company context and valid query/fragment destinations when later navigation is built. Do not turn a deep link into a grant of access. API `[id]` placeholders denote actual validated IDs; page `<id>` placeholders are explanatory.

1. HR: `/import` → `/exceptions?run=<id>` → `/runs/<id>#calculation-trace`. Source evidence, exception decisions and trace remain visible to permitted reviewers.
2. Payment reviewer: `/settlement?run=<id>` → plan holds → separate sign/open/execute controls → independently matched receipt. SIMULATION exposes no payment authority; a payroll approver cannot authorize the same run.
3. Company switch → `/workers?worker=<id>` → worker history/source evidence and table comment. Switching company rechecks membership and must not carry old tenant data into the new company.

Additional preserved links: `/dashboard#pay-runs`, `/dashboard?run=<id>`, `/runs/<id>?baseline=<baseline-id>`, `/runs/<id>#readiness-heading`, `#comparison-heading`, `#review-heading`, `#trace-<line-id>`, `/api/runs/<id>/review?download=1`, `/invite/<token>` and `/receipt/<token>`. Public anchors are `/#how-it-works`, `/#who-its-for`, `/#faq`, `/#join` and `#main`.

Known link limitations are documented rather than repaired by this task: `/import?run=<id>` is emitted by existing navigation, but the current import page does not consume that query as preselection. Invalid/unavailable exception-run selection falls back to its loaded run list; invalid settlement-run selection is ignored in favor of its default. OAuth return destinations use the narrower [safeNext allowlist](../src/server/auth/oauth.ts); do not assume all routes, queries or anchors below survive login return.

Admin handler URLs in the index are internal source paths, blocked directly by the [proxy](../src/proxy.ts). Their browser paths are `/<ADMIN_PATH>/api/...` (replace `/api/admin` with that prefix); admin page paths similarly replace `/admin`. The placeholder is intentional; never document the configured secret.

## Complete handler index

The method-specific guard below is only the entry condition. Explicit action restrictions above and repository checks can be narrower. `Member` means no extra guard role list; it does not mean unrestricted financial/table access. `Company` means no run-mode parameter at this guard, not exemption from the live switch or object rules. Source links identify each implemented handler. Extra re-auth refers to a second password/TOTP proof in the action request, not the credentials normally needed to log in or complete MFA. None at handler does not bypass repository/provider validation.

<!-- HANDLERS:START -->
| Method | Implemented handler | Guard actor | Mode / scope | Extra re-auth | Evidence |
|---|---|---|---|---|---|
| GET | `/api/admin/accounts` | Platform admin | Admin scope | None at handler | [source](../src/app/api/admin/accounts/route.ts) |
| GET | `/api/admin/billing` | Platform admin | Admin scope | None at handler | [source](../src/app/api/admin/billing/route.ts) |
| POST | `/api/admin/billing` | Platform admin | Admin scope | None at handler | [source](../src/app/api/admin/billing/route.ts) |
| POST | `/api/admin/contacts/[id]` | Platform admin | Admin scope | None at handler | [source](../src/app/api/admin/contacts/%5Bid%5D/route.ts) |
| GET | `/api/admin/export` | Platform admin | Admin scope | None at handler | [source](../src/app/api/admin/export/route.ts) |
| POST | `/api/admin/live-payments/[companyId]` | Platform admin | Admin scope | None at handler | [source](../src/app/api/admin/live-payments/%5BcompanyId%5D/route.ts) |
| POST | `/api/admin/login` | Admin gate; sign-in | Admin scope | None at handler | [source](../src/app/api/admin/login/route.ts) |
| POST | `/api/admin/logout` | Platform admin; aal1 allowed | Admin scope | None at handler | [source](../src/app/api/admin/logout/route.ts) |
| POST | `/api/admin/mfa/enroll` | Platform admin; aal1 allowed | Admin scope | None at handler | [source](../src/app/api/admin/mfa/enroll/route.ts) |
| POST | `/api/admin/mfa/verify` | Platform admin; aal1 allowed | Admin scope | None at handler | [source](../src/app/api/admin/mfa/verify/route.ts) |
| GET | `/api/admin/support` | Platform admin | Admin scope | None at handler | [source](../src/app/api/admin/support/route.ts) |
| GET | `/api/admin/support/[id]` | Platform admin | Admin scope | None at handler | [source](../src/app/api/admin/support/%5Bid%5D/route.ts) |
| POST | `/api/admin/support/[id]` | Platform admin | Admin scope | None at handler | [source](../src/app/api/admin/support/%5Bid%5D/route.ts) |
| POST | `/api/auth/login` | Public | Company / account | None at handler | [source](../src/app/api/auth/login/route.ts) |
| POST | `/api/auth/logout` | Member; aal1 allowed | Company / account | None at handler | [source](../src/app/api/auth/logout/route.ts) |
| POST | `/api/auth/mfa/enroll` | Member; aal1 allowed | Company / account | None at handler | [source](../src/app/api/auth/mfa/enroll/route.ts) |
| POST | `/api/auth/mfa/verify` | Member; aal1 allowed | Company / account | None at handler | [source](../src/app/api/auth/mfa/verify/route.ts) |
| POST | `/api/auth/oauth/google` | Public | Company / account | None at handler | [source](../src/app/api/auth/oauth/google/route.ts) |
| POST | `/api/auth/password` | Member | Company / account | Current password | [source](../src/app/api/auth/password/route.ts) |
| POST | `/api/batches/[id]/close` | M | Live only | None at handler | [source](../src/app/api/batches/%5Bid%5D/close/route.ts) |
| POST | `/api/batches/[id]/discard` | M | Live only | None at handler | [source](../src/app/api/batches/%5Bid%5D/discard/route.ts) |
| POST | `/api/batches/[id]/execute` | M | Live only | None at handler | [source](../src/app/api/batches/%5Bid%5D/execute/route.ts) |
| POST | `/api/batches/[id]/open` | M | Live only | None at handler | [source](../src/app/api/batches/%5Bid%5D/open/route.ts) |
| POST | `/api/batches/[id]/sign` | M | Live only | Password | [source](../src/app/api/batches/%5Bid%5D/sign/route.ts) |
| POST | `/api/billing/checkout` | O | Stripe TEST | Password | [source](../src/app/api/billing/checkout/route.ts) |
| POST | `/api/billing/collect` | O | Stripe TEST | Password | [source](../src/app/api/billing/collect/route.ts) |
| POST | `/api/billing/commands/reconcile` | O | Stripe TEST | None at handler | [source](../src/app/api/billing/commands/reconcile/route.ts) |
| POST | `/api/billing/reconcile` | O | Stripe TEST | None at handler | [source](../src/app/api/billing/reconcile/route.ts) |
| GET | `/api/billing` | O | Stripe TEST | None at handler | [source](../src/app/api/billing/route.ts) |
| GET | `/api/billing/usage` | O | Stripe TEST | None at handler | [source](../src/app/api/billing/usage/route.ts) |
| POST | `/api/circle/webhook` | Public | Testnet | None at handler | [source](../src/app/api/circle/webhook/route.ts) |
| POST | `/api/companies` | O | Company / account | None at handler | [source](../src/app/api/companies/route.ts) |
| POST | `/api/companies/switch` | Signed-in target-company member | Company / account | None at handler | [source](../src/app/api/companies/switch/route.ts) |
| POST | `/api/company/live-payments` | O / M | Company / account | Password + fresh TOTP (ON only) | [source](../src/app/api/company/live-payments/route.ts) |
| POST | `/api/company` | O | Company / account | None at handler | [source](../src/app/api/company/route.ts) |
| POST | `/api/configs` | P / H | Company / account | None at handler | [source](../src/app/api/configs/route.ts) |
| POST | `/api/configs/[id]` | P / H | Company / account | None at handler | [source](../src/app/api/configs/%5Bid%5D/route.ts) |
| POST | `/api/exceptions/bulk` | P / H | Both; state-scoped | None at handler | [source](../src/app/api/exceptions/bulk/route.ts) |
| POST | `/api/exceptions/[id]` | P / H | Both; state-scoped | None at handler | [source](../src/app/api/exceptions/%5Bid%5D/route.ts) |
| GET | `/api/gateway/topup` | O / M | Testnet | None at handler | [source](../src/app/api/gateway/topup/route.ts) |
| POST | `/api/gateway/topup` | O / M | Testnet | Password | [source](../src/app/api/gateway/topup/route.ts) |
| POST | `/api/gateway/topup/[id]` | O / M | Testnet | None at handler | [source](../src/app/api/gateway/topup/%5Bid%5D/route.ts) |
| POST | `/api/imports` | P / H | Both; state-scoped | None at handler | [source](../src/app/api/imports/route.ts) |
| POST | `/api/invites/accept` | Public | Company / account | None at handler | [source](../src/app/api/invites/accept/route.ts) |
| POST | `/api/invites` | O | Company / account | Password for authority grants | [source](../src/app/api/invites/route.ts) |
| POST | `/api/invites/[id]/revoke` | O | Company / account | None at handler | [source](../src/app/api/invites/%5Bid%5D/revoke/route.ts) |
| POST | `/api/payments/recover` | M / O | Testnet | None at handler | [source](../src/app/api/payments/recover/route.ts) |
| POST | `/api/receipts` | O / H / P / M | Company / account | None at handler | [source](../src/app/api/receipts/route.ts) |
| POST | `/api/runs` | P / H | Both; state-scoped | None at handler | [source](../src/app/api/runs/route.ts) |
| POST | `/api/runs/[id]/adjustments` | H / P | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/adjustments/route.ts) |
| POST | `/api/runs/[id]/approve` | P / H | Live only | Password | [source](../src/app/api/runs/%5Bid%5D/approve/route.ts) |
| POST | `/api/runs/[id]/calculate` | P / H | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/calculate/route.ts) |
| GET | `/api/runs/[id]/corrections` | H / P / M | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/corrections/route.ts) |
| POST | `/api/runs/[id]/corrections` | H / P | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/corrections/route.ts) |
| GET | `/api/runs/[id]/evidence` | H / P / M | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/evidence/route.ts) |
| POST | `/api/runs/[id]/obligations` | P / H | Live only | None at handler | [source](../src/app/api/runs/%5Bid%5D/obligations/route.ts) |
| POST | `/api/runs/[id]/plan` | M | Live only | None at handler | [source](../src/app/api/runs/%5Bid%5D/plan/route.ts) |
| GET | `/api/runs/[id]/readiness` | Member | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/readiness/route.ts) |
| POST | `/api/runs/[id]/readiness` | H / P | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/readiness/route.ts) |
| POST | `/api/runs/[id]/reconcile/retry` | P / H | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/reconcile/retry/route.ts) |
| POST | `/api/runs/[id]/reconcile` | P / H | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/reconcile/route.ts) |
| POST | `/api/runs/[id]/reject` | P / H | Live only | None at handler | [source](../src/app/api/runs/%5Bid%5D/reject/route.ts) |
| GET | `/api/runs/[id]/review` | P / H / M | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/review/route.ts) |
| POST | `/api/runs/[id]/review` | P / H | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/review/route.ts) |
| POST | `/api/runs/[id]/submit` | P / H | Live only | None at handler | [source](../src/app/api/runs/%5Bid%5D/submit/route.ts) |
| GET | `/api/runs/[id]/tasks` | H / P | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/tasks/route.ts) |
| POST | `/api/runs/[id]/tasks` | H / P | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/tasks/route.ts) |
| GET | `/api/runs/[id]/thresholds` | H / P / M | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/thresholds/route.ts) |
| POST | `/api/runs/[id]/thresholds` | H / P | Both; state-scoped | None at handler | [source](../src/app/api/runs/%5Bid%5D/thresholds/route.ts) |
| GET | `/api/standing-authorizations` | M | Company / account | None at handler | [source](../src/app/api/standing-authorizations/route.ts) |
| POST | `/api/standing-authorizations` | M | Company / account | Password for create; none for revoke | [source](../src/app/api/standing-authorizations/route.ts) |
| POST | `/api/stripe/webhook` | Public | Stripe TEST | None at handler | [source](../src/app/api/stripe/webhook/route.ts) |
| GET | `/api/support` | Member | Company / account | None at handler | [source](../src/app/api/support/route.ts) |
| POST | `/api/support` | Member | Company / account | None at handler | [source](../src/app/api/support/route.ts) |
| GET | `/api/support/[id]` | Member | Company / account | None at handler | [source](../src/app/api/support/%5Bid%5D/route.ts) |
| POST | `/api/support/[id]` | Member | Company / account | None at handler | [source](../src/app/api/support/%5Bid%5D/route.ts) |
| GET | `/api/tables/[table]/named-views` | Member | Company / account | None at handler | [source](../src/app/api/tables/%5Btable%5D/named-views/route.ts) |
| POST | `/api/tables/[table]/named-views` | Member | Company / account | None at handler | [source](../src/app/api/tables/%5Btable%5D/named-views/route.ts) |
| GET | `/api/tables/[table]/named-views/[id]` | Member | Company / account | None at handler | [source](../src/app/api/tables/%5Btable%5D/named-views/%5Bid%5D/route.ts) |
| POST | `/api/tables/[table]/named-views/[id]` | Member | Company / account | None at handler | [source](../src/app/api/tables/%5Btable%5D/named-views/%5Bid%5D/route.ts) |
| POST | `/api/team/[id]` | O | Company / account | Password for authority grants | [source](../src/app/api/team/%5Bid%5D/route.ts) |
| GET | `/api/views/comments` | Member | Company / account | None at handler | [source](../src/app/api/views/comments/route.ts) |
| POST | `/api/views/comments` | Member | Company / account | None at handler | [source](../src/app/api/views/comments/route.ts) |
| POST | `/api/views/export` | Member | Company / account | None at handler | [source](../src/app/api/views/export/route.ts) |
| GET | `/api/views/layout` | Member | Company / account | None at handler | [source](../src/app/api/views/layout/route.ts) |
| POST | `/api/views/layout` | Member | Company / account | None at handler | [source](../src/app/api/views/layout/route.ts) |
| POST | `/api/views/query` | Member | Company / account | None at handler | [source](../src/app/api/views/query/route.ts) |
| POST | `/api/views/resources/propose` | H / P | Company / account | None at handler | [source](../src/app/api/views/resources/propose/route.ts) |
| GET | `/api/views/resources` | H / P | Company / account | None at handler | [source](../src/app/api/views/resources/route.ts) |
| POST | `/api/views/resources` | H / P | Company / account | None at handler | [source](../src/app/api/views/resources/route.ts) |
| GET | `/api/views/resources/[id]/inputs` | H / P | Company / account | None at handler | [source](../src/app/api/views/resources/%5Bid%5D/inputs/route.ts) |
| POST | `/api/views/resources/[id]/inputs` | H / P | Company / account | None at handler | [source](../src/app/api/views/resources/%5Bid%5D/inputs/route.ts) |
| POST | `/api/waitlist` | Public | Waitlist scope | None at handler | [source](../src/app/api/waitlist/route.ts) |
| POST | `/api/waitlist/survey` | Public | Waitlist scope | None at handler | [source](../src/app/api/waitlist/survey/route.ts) |
| POST | `/api/workers` | P / H | Company / account | None at handler | [source](../src/app/api/workers/route.ts) |
| POST | `/api/workers/[id]/archive` | P / H | Company / account | None at handler | [source](../src/app/api/workers/%5Bid%5D/archive/route.ts) |
| POST | `/api/workers/[id]/compensation` | P / H | Company / account | None at handler | [source](../src/app/api/workers/%5Bid%5D/compensation/route.ts) |
| POST | `/api/workers/[id]/effective-compensation/preview` | H / P | Company / account | None at handler | [source](../src/app/api/workers/%5Bid%5D/effective-compensation/preview/route.ts) |
| GET | `/api/workers/[id]/effective-compensation` | H / P / M | Company / account | None at handler | [source](../src/app/api/workers/%5Bid%5D/effective-compensation/route.ts) |
| POST | `/api/workers/[id]/effective-compensation` | H / P | Company / account | None at handler | [source](../src/app/api/workers/%5Bid%5D/effective-compensation/route.ts) |
| POST | `/api/workers/[id]/metadata` | H / P | Company / account | None at handler | [source](../src/app/api/workers/%5Bid%5D/metadata/route.ts) |
| POST | `/api/workers/[id]/reactivate` | P / H | Company / account | None at handler | [source](../src/app/api/workers/%5Bid%5D/reactivate/route.ts) |
| POST | `/api/workers/[id]/recipient/confirm` | M | Company / account | Password | [source](../src/app/api/workers/%5Bid%5D/recipient/confirm/route.ts) |
| POST | `/api/workers/[id]/recipient` | P / H | Company / account | None at handler | [source](../src/app/api/workers/%5Bid%5D/recipient/route.ts) |
| POST | `/api/workers/[id]/wallet` | P / H | Company / account | None at handler | [source](../src/app/api/workers/%5Bid%5D/wallet/route.ts) |
| GET | `/api/x402/verify` | Public | Read-only payment proof | None at handler | [source](../src/app/api/x402/verify/route.ts) |
| GET | `/auth/callback` | Public | Company / account | None at handler | [source](../src/app/auth/callback/route.ts) |
<!-- HANDLERS:END -->

## Complete page index

No `/help`, `/runs`, `/survey` or `/thanks` page exists in this source snapshot. Page access is not proof of permission to invoke an action. Read-only or restricted pages may still render for members who cannot see payroll fields. The page index records existing destinations; no new menu placement is approved here.

<!-- PAGES:START -->
| Existing page | Server access / actions | Mode / selection | Evidence |
|---|---|---|---|
| `/invite/[token]` | Public validated invite | App; one-use, expiry, token/email checks | [source](../src/app/%28app%29/%28auth%29/invite/%5Btoken%5D/page.tsx) |
| `/login` | Public | App; error, step=mfa, factor, allowlisted next | [source](../src/app/%28app%29/%28auth%29/login/page.tsx) |
| `/onboarding` | O; aal1 allowed | Non-O/already onboarded redirects dashboard | [source](../src/app/%28app%29/%28auth%29/onboarding/page.tsx) |
| `/select-company` | Signed-in member (pageUser) | Existing verified factor needs aal2; no active company needed | [source](../src/app/%28app%29/%28auth%29/select-company/page.tsx) |
| `/account` | Member; aal1 allowed | MFA setup and password security | [source](../src/app/%28app%29/%28workspace%29/account/page.tsx) |
| `/audit` | Member; scoped timeline | Both; run, entity, before timestamp~UUID; invalid filter 404 | [source](../src/app/%28app%29/%28workspace%29/audit/page.tsx) |
| `/configuration` | Member; H/P proposal/action controls | Company config; user-scoped data access | [source](../src/app/%28app%29/%28workspace%29/configuration/page.tsx) |
| `/dashboard` | Member; H/P/M financial details | Both; run UUID scoped; unonboarded O redirects | [source](../src/app/%28app%29/%28workspace%29/dashboard/page.tsx) |
| `/exceptions` | Member; H/P acts | Both; run query among latest 20 non-DRAFT runs; fallback newest | [source](../src/app/%28app%29/%28workspace%29/exceptions/page.tsx) |
| `/import` | Member; H/P imports | Both; DRAFT/DATA_IMPORTED choices; run query not consumed | [source](../src/app/%28app%29/%28workspace%29/import/page.tsx) |
| `/runs/[runId]` | Member; H/P/M financial details; H/P payroll actions | Both; baseline run; invalid/missing run 404 | [source](../src/app/%28app%29/%28workspace%29/runs/%5BrunId%5D/page.tsx) |
| `/runs/[runId]/workflow` | Member; private financial facts H/P/M | Both; read-only scoped run; missing facts 404 | [source](../src/app/%28app%29/%28workspace%29/runs/%5BrunId%5D/workflow/page.tsx) |
| `/settings/billing` | O billing data; other members see access explanation | Stripe TEST; separate from payroll mode | [source](../src/app/%28app%29/%28workspace%29/settings/billing/page.tsx) |
| `/settings/company` | Member; O edits | Company details | [source](../src/app/%28app%29/%28workspace%29/settings/company/page.tsx) |
| `/settings/team` | Member; O manages/invite list | Company membership; authority-role grants re-auth | [source](../src/app/%28app%29/%28workspace%29/settings/team/page.tsx) |
| `/settlement` | Member; H/P/M financial evidence; M pays; O controls | Live eligible runs; run query among latest 10; invalid selection falls back | [source](../src/app/%28app%29/%28workspace%29/settlement/page.tsx) |
| `/support` | Member; accessible submitted ticket evidence | ticket UUID query; invalid selection shows error | [source](../src/app/%28app%29/%28workspace%29/support/page.tsx) |
| `/workers` | Member directory; H/P/M financial details; H/P edits; M confirms | worker query for history; invalid/missing selection 404 | [source](../src/app/%28app%29/%28workspace%29/workers/page.tsx) |
| `/` | Public | App and waitlist; existing public anchors | [source](../src/app/%28public%29/page.tsx) |
| `/privacy` | Public | App and waitlist | [source](../src/app/%28public%29/privacy/page.tsx) |
| `/<ADMIN_PATH>/billing` | Platform admin (password + aal2) | Private gate; billing administration; current page says collection unavailable | [source](../src/app/admin/billing/page.tsx) |
| `/<ADMIN_PATH>/contacts/[id]` | Platform admin (password + aal2) | Private gate; validated contact ID | [source](../src/app/admin/contacts/%5Bid%5D/page.tsx) |
| `/<ADMIN_PATH>/login` | Private admin gate | Public sign-in behind secret path | [source](../src/app/admin/login/page.tsx) |
| `/<ADMIN_PATH>` | Platform admin (password + aal2) | Private gate; q/status/role/pain/budget/call/source/from/to/page filters | [source](../src/app/admin/page.tsx) |
| `/<ADMIN_PATH>/support` | Platform admin (password + aal2) | Private gate; ticket query | [source](../src/app/admin/support/page.tsx) |
| `/receipt/[token]` | Public signed token | App; rate-limit, expiry/refusal; noindex/no-referrer | [source](../src/app/receipt/%5Btoken%5D/page.tsx) |
<!-- PAGES:END -->

## Acceptance

- Every exported HTTP method in `src/app/**/route.ts` appears once in the handler index, including the OAuth callback.
- Every `src/app/**/page.tsx` appears once in the page index, with route groups removed from URLs.
- All source links resolve; all role lists agree with the guarded options and action-specific conditions are explicit.
- Owner approval is pending. Future navigation implementation and the three authenticated browser journeys belong to R9.2–R9.10.
