# Kleeno — Pages and Experience

What each page is for, who uses it, and how it should feel. Visual rules: `DESIGN.md` + ESSENTIALS rule 45. Security rules for each page: `docs/security.md`. Status: draft for user approval.

## 1. How people should feel
Payroll is money people live on, and the data is confidential. Every page should leave the visitor feeling:
- **In control.** Nothing happens without a human. AI suggestions are labelled "Suggested by AI, not applied" until someone accepts them.
- **Safe.** Privacy is visible where it matters: "Names stay on this computer" at import, a lock note on encrypted data, a clear LIVE or SIMULATION badge on every run.
- **Certain.** Show evidence, not claims: trace lines, source rows, arcscan links. "Why was this flagged?" is answered from stored evidence.
- **Calm.** Plain words, no hype, no crypto jargon above the fold. One primary action per screen. Signal Orange only for decisions and risks (approve, exception, DO NOT PAY).
- **Respected.** Errors say what happened and what to do next, plus a support code (correlation ID), never a stack trace. Empty states explain the next step.

Tone of copy: short, precise, warm. We say "Arc testnet USDC, no real funds" wherever money appears in public material.

## 2. Page map (17 pages)

| # | Route | Access | For | Represents | Feeling | Phase |
|---|---|---|---|---|---|---|
| 1 | `/` | public | business owners, pilots, judges | Landing page: what Kleeno is and why it is safe (§3) | "This understands my problem, and it won't do anything behind my back." | P5 |
| 2 | `/privacy` | public | pilots, workers, judges | Data and security note: what we never see, what we store (encrypted), where, how long, how to delete | "I know exactly what happens to my data." | P3 |
| 3 | `/login` | public | invited users | Email + password, then MFA code for real companies. No sign-up link ("Join by invite: request access on the home page"). | Quick, serious, private. | P2 |
| 4 | `/receipt/[token]` | signed link | a worker | One payment: amount, date, network, tx hash, arcscan link. No name. Works at 390px. | "I was paid, and here is the proof." | P4 |
| 5 | `/account` | signed in | every user | Password change, MFA enrolment, my companies and roles, sign out | "My account is locked down." | P2 |
| 6 | `/dashboard` | signed in | every role | Setup checklist for new companies (P3b), then the period stepper, number tiles, my to-dos, AI activity feed, run mode badge, live-payments status (§6). | "I know where things stand and what's next." | P1 crude, P3b checklist, P4d full |
| 7 | `/configuration` | HR approver | HR | Policy text or documents (PDF, Word, TXT, Markdown; P4c) -> AI-proposed rules with cited clauses and scopes -> category counts, per-worker coverage, overrides to tick, clashes and duplicates -> validation log -> approve a version | "The AI understood my policy, and I can see why." | P3, P4c |
| 8 | `/workers` | signed in | every role | Pseudonymous workers (W001…; names after unlocking the key file in this browser, P4c), pay type, compensation, wallet, job title, department, worker type, tags, start date, per-worker history panel; recipient changes waiting for the other role | "Every payee is accounted for; changes need a second pair of eyes." | P2, P4c |
| 9 | `/import` | HR approver | HR | CSV or Excel (P4c) parse in the browser, column mapping, name stripping, passphrase for the name key file, results with rejected rows | "My staff's names never left this computer." | P3 |
| 10 | `/exceptions` | HR approver | HR | Flagged issues with evidence, the AI's suggestion (not applied) and resolution | "Nothing slips past, and I make the call." | P3 |
| 11 | `/runs/[runId]` | signed in | both roles | Payroll review: totals, trace per worker, invariant checks, variance (SIMULATION), approval with re-auth | "I can check every cent before I approve." | P1 crude, P4 full |
| 12 | `/settlement` | payment approver, Owner | payments | Plan with flags and holds, signing (re-auth), standing authorization, **live payments OFF** switch, live-payments request and Owner ON switch (re-auth + TOTP), Gateway top-up of the payroll wallet, payment status, Arc reconciliation | "Money moves only exactly as I signed, and I can stop it instantly." | P4 |
| 13 | `/audit` | signed in | both roles, judges | Timeline: policy -> data -> exception -> calculation -> approval -> obligation -> plan -> transaction | "Every step is on record." | P5 |
| 14 | `/invite/[token]` | signed link | invited people | Accept an invite: create a password (or sign in if the email exists), see the company and roles offered. A bad, used or expired link gets one calm message. | "I was invited, and I know what I'm joining." | P3b |
| 15 | `/onboarding` | Owner of a new company | Owners | 3 screens: secure your account (password, two-step code), company basics, pay schedule. Progress dots, back and skip-to-later for optional fields. | "That took two minutes." | P3b |
| 16 | `/settings/company` | Owner (others read) | Owners | Company details, pay schedule; legal details and logo later | "Our company is set up properly." | P3b |
| 17 | `/settings/team` | Owner (others read) | Owners | Members with roles, invite with roles (copy link or email), pending invites, revoke, remove; the last Owner is protected | "I decide who can do what." | P3b |

**Waitlist mode (W, from 2026-10-01 until P5):** the public site is only `/` (landing + waitlist + survey), `/privacy` and a branded 404. Every other page returns the same 404 until `SITE_MODE=app` is set at P5. The private lead list lives at a secret path (`/<ADMIN_PATH>`: login with MFA, list + metrics, contact detail). Spec: `docs/phases/W.md`.

Navigation (signed in): company switcher (left end of the nav pill: current company, list of my companies, "Create company") · Dashboard · Runs · Exceptions · Workers · Settlement · more menu (Configuration, Import, Audit, Team, Company, Account). That is at most six top-level links (DESIGN.md).

Admin area (secret path, W + P3b + P4): lead list, **access requests** (approve a waitlist entry into an invite link, reject) and **live-payment requests** (approve or reject; shows provisioning progress). Role decides which actions show; the server still checks every action (rule 33).

Later (not one of the 13): `/settings/integrations`. It has small cards per category showing connected or not, capabilities, last sync, data types, reauthorize, disconnect and errors. It never shows secrets or raw API detail (`docs/integrations/README.md`).

## 3. Landing page (`/`)
**Built in W as a waitlist page** (2026-10-01): hero "AI payroll reconciliation for teams that pay contractors." with the waitlist form beside it, problem cards, How it works (Policy -> Check -> Approve -> Pay), Who it's for (US businesses paying contractors, payroll/finance leads, payroll bureaus and accounting firms, founders), principles, FAQ (also FAQPage structured data), closing CTA, ink footer. SEO targets: AI payroll, payroll reconciliation, contractor payments, payroll audit trail. At P5 add the "Try the live demo" CTA and the Arc/USDC safety section below as the second CTA; the plan that follows is the P5 target.

Goal: in 30 seconds a visitor understands the problem, the safety model and how to try it. Editorial style from `DESIGN.md` (cream canvas, orbit arcs, pill CTAs); no real names or faces of workers.

1. **Nav pill:** Kleeno · How it works · Security · Demo · Log in.
2. **Hero:** headline "Payroll that can't pay the wrong person." Sub: "AI reads your pay policy and messy timesheets. Plain code does the maths. You approve. A smart contract pays exactly what you approved, in USDC on Arc." Primary CTA "Try the live demo" (ink pill); secondary "How it works". Small line: "Arc testnet · no real funds".
3. **The problem:** three short cards: missed or unapproved hours, duplicate timesheets, payments to a changed wallet. "Spreadsheets hide these. Kleeno flags them with evidence."
4. **How it works:** four orbit steps: Policy -> Check -> Approve -> Settle, one sentence each.
5. **Safety:** "AI proposes. You decide. The contract enforces." Three points: two different people approve payroll and payment; the contract can pay only approved amounts to approved wallets, once; every payment is verified on-chain and audited.
6. **Privacy:** "Your staff's names never leave your browser." Encrypted in transit and at rest; MFA; delete on request. Link to `/privacy`.
7. **Who it's for:** teams paying employees and remote contractors.
8. **Proof:** real pilot numbers only (rule 42). Until there are any, show the demo walkthrough instead of numbers.
9. **Closing CTA + ink footer:** demo, log in, privacy, GitHub; "Built for the Tameion Agents Hackathon on Arc."

## 4. Page rules
- Public pages (`/`, `/privacy`, `/receipt`) show no company data except the one receipt, and are `noindex` where they reveal pay (receipt).
- Working screens are dense and readable; decorative motifs stay on the landing page and empty states (rule 45).
- AI text and uploaded data render as plain text (rule 6).
- Every approval-type action shows what it will do before it does it (amount, recipient, network, token) and asks for re-auth where rule 47 requires it.

## 5. Table views (direction set by the user, 2026-10-01; payroll additions 2026-10-02)
Every list of records (workers, run lines, exceptions, obligations, payments, audit) should become a dynamic table view like Excel or Notion, so HR can see who is being paid and what has been done in a familiar layout. P2's `/workers` table is deliberately static; this replaces it from P3.
- **Behaviour:** user-chosen columns (show, hide, reorder, resize), sort, filter (by status, pay type, active or left, date, amount range), group, saved named views, and a search box. Rows and columns vary by page and by role.
- **AI part:** the user asks in plain words ("who has unpaid obligations this period", "contractors paid over 2,000") and the AI proposes a *view definition* (columns, filters, sort, grouping) as strict structured data. It never writes SQL and never changes records. The user sees the view and can edit it; saving it is a human action.
- **Safety:** view definitions are validated against a per-table allow-list of columns and operators. Filtering and sorting run on the server through the same repositories, scoped by session company and role (RLS applies); encrypted fields are decrypted on the server only for the columns a role may see, then filtered in memory (no plaintext in SQL). Row actions (change pay, mark as left, approve) remain the existing guarded routes. Audit records who saw or exported what only where `docs/security.md` already requires it.
- **Payroll additions (user, 2026-10-02, after comparing Tabulera and Woodrow):**
  - *Match status column*: each record shows matched automatically, matched after review, or exception; the page header shows the count ("212 of 230 matched automatically, 18 need review", rule 42: real counts only, empty without data).
  - *Select rows, act once*: bulk resolve for exceptions of one category with one required note; each exception still gets its own resolution and audit event. Approvals, plan signing and hold release stay one at a time.
  - *Row side panel*: click a row to see the worker, the evidence behind an exception, or the trace behind an amount, without leaving the table.
  - *Totals row*: sums for amount columns (gross, deductions, net, paid), computed on the server from the rows the view shows.
  - *Export to CSV*: the current view, only the columns the role may see, escaped like S25, and audited.
- **Not Excel:** no typing into cells for pay or records. Row actions open the existing guarded actions (reason required, audited, re-auth where rule 47 says).
- **Library:** shadcn's data-table pattern on TanStack Table (headless; styled per `DESIGN.md`).
- **Build order:** P3 builds one reusable table view component and a view-definition schema, starts with workers, import results and exceptions, and the AI "describe the view" step. Other pages adopt it as they are built. Cut order if time runs short: AI view proposals first, saved views second, side panel third; manual columns, filters, match status, totals, bulk resolve and export stay.
- **Later (advanced, `docs/roadmap.md`):** inline edits that create a reviewed change request, conditional highlighting, pivot and chart views, views shared per team, scheduled exports, keyboard navigation for power users.

## 6. Dashboard and motion (P4d; user, 2026-10-02, after reviewing Tabulera and Woodrow)
Why: the P1 dashboard only knows the company and its runs, and it doesn't say where a period stands. Tabulera leads with exception-first numbers (auto-cleared share, variance categories, lock when done); Woodrow shows AI work as visible steps with run logs and approval gates that say why input is needed. Kleeno takes both ideas in its own visual system.
- **Setup checklist** (new companies, P3b): invite team · add workers · upload and approve policy · request live payments · first run. Progress bar; items tick off with a short animation.
- **Period stepper:** Policy → Import → Exceptions → Calculation → Approval → Settlement. Each step: done, current or blocked, with a count ("3 open"); the line fills as steps finish; clicking a step opens its page.
- **Number tiles:** workers in this run, share matched automatically, open exceptions (Signal Orange), total to pay. Real counts only, empty without data (rule 42).
- **My to-dos:** next actions for my roles, each with the reason it needs me ("Approve run 2026-10: you are the payroll approver").
- **AI activity feed:** plain entries from `ai_executions` and audit events ("Rules proposed from Handbook v2, 3 clauses cited", "Import: 42 rows, 2 rejected"), each linking to its evidence. Labelled "Suggested by AI, not applied" where it applies.
- **Runs table:** the P3 table view, not the plain list.
- **Per-worker history panel** (on `/workers`): past runs, pay changes, exceptions and payments for one worker.
- **Motion** (`DESIGN.md` §10): staggered fade-in on load, stepper fill, number tiles animating to new values, hover lift on cards and rows, skeletons while loading, slide-in side panels. 150–250 ms, never delays an approval or hides an amount, off under `prefers-reduced-motion`.
