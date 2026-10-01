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

## 2. Page map (13 pages)

| # | Route | Access | For | Represents | Feeling | Phase |
|---|---|---|---|---|---|---|
| 1 | `/` | public | business owners, pilots, judges | Landing page: what Kleeno is and why it is safe (§3) | "This understands my problem, and it won't do anything behind my back." | P5 |
| 2 | `/privacy` | public | pilots, workers, judges | Data and security note: what we never see, what we store (encrypted), where, how long, how to delete | "I know exactly what happens to my data." | P3 |
| 3 | `/login` | public | invited users | Email + password, then MFA code for real companies. No sign-up link ("Accounts are created by Kleeno"). | Quick, serious, private. | P2 |
| 4 | `/receipt/[token]` | signed link | a worker | One payment: amount, date, network, tx hash, arcscan link. No name. Works at 390px. | "I was paid, and here is the proof." | P4 |
| 5 | `/account` | signed in | every user | Password change, MFA enrolment, role and company, sign out | "My account is locked down." | P2 |
| 6 | `/dashboard` | signed in | both roles | The current period as a stepper: config -> import -> exceptions -> calculation -> approval -> settlement. Shows my to-dos, run mode badge, live-payments status. | "I know where things stand and what's next." | P1 crude, P5 full |
| 7 | `/configuration` | HR approver | HR | Policy text -> AI-proposed rules with cited clauses -> validation log -> approve a version | "The AI understood my policy, and I can see why." | P3 |
| 8 | `/workers` | signed in | both roles | Pseudonymous workers (W001…), pay type, compensation, wallet; recipient changes waiting for the other role | "Every payee is accounted for; changes need a second pair of eyes." | P2 |
| 9 | `/import` | HR approver | HR | CSV parse in the browser, column mapping, name stripping, passphrase for the name key file, results with rejected rows | "My staff's names never left this computer." | P3 |
| 10 | `/exceptions` | HR approver | HR | Flagged issues with evidence, the AI's suggestion (not applied) and resolution | "Nothing slips past, and I make the call." | P3 |
| 11 | `/runs/[runId]` | signed in | both roles | Payroll review: totals, trace per worker, invariant checks, variance (SIMULATION), approval with re-auth | "I can check every cent before I approve." | P1 crude, P4 full |
| 12 | `/settlement` | payment approver | payments | Plan with flags and holds, signing (re-auth), standing authorization, **live payments OFF** switch, payment status, Arc reconciliation | "Money moves only exactly as I signed, and I can stop it instantly." | P4 |
| 13 | `/audit` | signed in | both roles, judges | Timeline: policy -> data -> exception -> calculation -> approval -> obligation -> plan -> transaction | "Every step is on record." | P5 |

**Waitlist mode (W, from 2026-10-01 until P5):** the public site is only `/` (landing + waitlist + survey), `/privacy` and a branded 404. Every other page returns the same 404 until `SITE_MODE=app` is set at P5. The private lead list lives at a secret path (`/<ADMIN_PATH>`: login with MFA, list + metrics, contact detail). Spec: `docs/phases/W.md`.

Navigation (signed in): Dashboard · Runs · Exceptions · Workers · Settlement · more menu (Configuration, Import, Audit, Account). That is at most six top-level links (DESIGN.md). Role decides which actions show; the server still checks every action (rule 33).

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

## 5. Table views (direction set by the user, 2026-10-01)
Every list of records (workers, run lines, exceptions, obligations, payments, audit) should become a dynamic table view like Excel or Notion, so HR can see who is being paid and what has been done in a familiar layout. P2's `/workers` table is deliberately static; this replaces it from P3.
- **Behaviour:** user-chosen columns (show, hide, reorder, resize), sort, filter (by status, pay type, active or left, date, amount range), group, saved named views, and a search box. Rows and columns vary by page and by role.
- **AI part:** the user asks in plain words ("who has unpaid obligations this period", "contractors paid over 2,000") and the AI proposes a *view definition* (columns, filters, sort, grouping) as strict structured data. It never writes SQL and never changes records. The user sees the view and can edit it; saving it is a human action.
- **Safety:** view definitions are validated against a per-table allow-list of columns and operators. Filtering and sorting run on the server through the same repositories, scoped by session company and role (RLS applies); encrypted fields are decrypted on the server only for the columns a role may see, then filtered in memory (no plaintext in SQL). Row actions (change pay, mark as left, approve) remain the existing guarded routes. Audit records who saw or exported what only where `docs/security.md` already requires it.
- **Build order:** P3 builds one reusable table view component and a view-definition schema, starts with workers and import results, and the AI "describe the view" step. Other pages adopt it as they are built. Cut order if time runs short: AI view proposals first, saved views second; manual column and filter controls stay.
