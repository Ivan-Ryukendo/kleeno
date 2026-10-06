# P3b — Company system (Oct 3–4)

Status: **merged to main** (`296354e`, PR #10). Git timestamp is 2026-10-02; the historical phase/user-check notes below label their work 2026-10-03. Preserve that discrepancy rather than assuming another merge is pending. P4 is also merged; current remaining sequence is in PRD §12 and `../p4-p5-readiness.md`.

## Goal
Real businesses join by an approved invite, create their company, invite their team with roles and set up through a short wizard and a checklist. One login can belong to many companies and switch between them, like Notion or ClickUp workspaces. This makes Kleeno usable by pilot companies and accounting firms, not only by our scripted users.

## Build slices (each ends green before the next)
1. **Foundation (merge first; P4 builds on it).** `memberships (user_id, company_id, roles[])` replaces `app_users` (existing rows migrated; roles `OWNER`, `HR_APPROVER`, `PAYROLL_APPROVER`, `PAYMENT_APPROVER`, `VIEWER`). Active company in a signed, httpOnly cookie, re-checked against `memberships` on every request. RLS by membership. The auth guard checks "role in the member's roles for the active company". The four-eyes triggers stay on user IDs. `src/core/tenancy` holds role sets and permission checks.
2. **Invites and access approval.** `invites` (kind `PLATFORM` | `COMPANY`, email, company, roles, token hash, expiry, used, revoked). In the admin area, a waitlist entry gets "Approve access", which creates a platform invite. An Owner invites team members with roles. `/invite/[token]`: a new email creates its account on the server (Supabase sign-up stays off), and an existing email signs in and joins. A platform invite creates a new company with the user as Owner. Delivery: a copyable link now; automatic email when `RESEND_API_KEY` is set (optional env; without it, link only).
3. **Onboarding wizard and company profile.** `/onboarding`, 3 screens: account security (password, TOTP enrolment; required for real companies), company basics (name, country, time zone, size range, industry), pay schedule (frequency, usual pay day). New company columns. Legal details and logo come later.
4. **Team, settings and switcher.** `/settings/company` (Owner edits), `/settings/team` (members, roles, invite, revoke an invite, remove a member; the last Owner can't be removed or demoted). A company switcher in the nav lists the user's companies. An approved user can create another company from the switcher (it starts in SIMULATION and needs its own live-payments approval).
5. **Setup checklist.** On `/dashboard`, computed from data: team invited, workers added, policy approved, live payments requested, first run. Progress bar; each item links to its page. The full dashboard comes in P4d.

Judges: the shared demo company stays. An optional judge invite link creates a **sandbox** company (`is_sandbox`), which can never request or switch on live payments (DB CHECK).

Backend slices use Ponytail `full`, then `ponytail-review`. UI last, per `DESIGN.md` and `docs/pages.md`.

## Decisions (user, 2026-10-02; change any before I start)
1. **Sign-up:** invite only. Businesses ask via the waitlist; the platform admin approves.
2. **Workspaces:** one login, many companies, switcher in the nav, roles per company.
3. **Roles:** new `OWNER` (company details, members, invites). A member may hold several roles. The same person can never approve payroll and authorize payment for the same run (DB trigger, unchanged), so live payments need at least two people. Granting `PAYROLL_APPROVER` or `PAYMENT_APPROVER` is an authority-granting action, so it needs re-authentication (rule 47).
4. **Team vs workforce:** setup covers both. The team logs in; the workforce gets paid (workers, P2 and P4c).
5. **Company info now:** name, country, time zone, size range, industry, pay frequency and usual pay day. Currency stays USD. **Later:** legal entity name, address, tax ID (encrypted, Owner-only) and logo.
6. **Invites:** one-time link, 7 days, bound to one email. Email is sent when Resend is configured; until then the sender copies the link.
7. **Onboarding:** short wizard plus the dashboard checklist.
8. **Judges:** demo company plus an optional sandbox invite.
9. **Email provider:** Resend (free tier) when the user creates the account and DNS records on orclide.com; optional, never blocks the phase.

## User checklist
- [ ] Approve this plan (or edit the decisions).
- [ ] Optional: create a Resend account, add its DNS records for orclide.com, put `RESEND_API_KEY` in `.env` and Vercel Production. This is a good moment to restore MX records, so `CONTACT_EMAIL` works again.
- [ ] Still owed: cloud Auth settings on `kleeno-dev`/`kleeno-prod`, `DATA_ENCRYPTION_KEY` offline copy.

## Done when
1. `npm run lint`, `typecheck`, `test`, `test:invariants`, `test:db` → exit 0; CI green.
2. One user in two companies sees only the active company's rows on every page, export and API route; switching changes everything; a forged company cookie gets 0 rows or 403 (tests).
3. The invite flow works end to end: approve access in admin → link → account → company + Owner → wizard → dashboard checklist. A used, expired, revoked or wrong-email link fails with one generic reply.
4. The Owner invites a member with two roles; that member still can't authorize payment for a run they approved (trigger test).
5. The last Owner can't be removed or demoted. Granting a payment role without re-auth gets 401.
6. A sandbox company can't request or switch on live payments (DB test).
7. The user sees it in the browser: invite → setup → switch companies.
8. Security rows below `verified`, or `unverified` with a reason. `PROGRESS.md` updated; one commit; PR; CI green; squash-merge.

### Security rows (`docs/security.md`)
S61–S65; S13 and S15 extended to the new routes; S43 updated (accounts created only by invite acceptance on the server).

## Result (2026-10-03)
All five slices are built on branch `p3b-company`. Migrations `20261003000001`–`3` are applied to `kleeno-dev` only (prod untouched). Checks: lint, typecheck and build pass; 248 unit + invariant tests; 174 DB tests (`tests/db/{memberships,invites,company}` are new). A real-browser run covered: invite link → account → wizard (authenticator code, basics, schedule) → dashboard checklist → team invite with the password prompt → switcher and second company → a second person joining → a used link.

**Deviations from the plan (small, for your review)**
- A user with exactly one company needs no company cookie (so scripts and existing tests keep working); with several companies and no valid choice every request is a 403 and pages send them to `/select-company`. A forged cookie is always a 403.
- Approving a waitlist entry creates the (empty) company at that moment, so there is only one invite table. A revoked or expired approval reuses the empty company.
- Members are removed softly (`removed_at`), never deleted, so approvals and audit rows that name them stay valid.
- Companies created by approval or by an Owner start with MFA required; judge sandboxes do not. A person who joins a real company without a second step is sent to `/account` to set one up.
- The setup checklist has four items (team, workers, policy, first run). "Live payments requested" joins it in P4, when the request exists.
- Two protected tests were adjusted, not weakened: `tests/invariants/workflow/simulation.test.ts` now passes `roles: [...]` (the context takes a list of roles), and `tests/invariants/security/app-structure.test.ts` lists `/api/invites/accept` as an open route (public, but only with a valid one-time token).

**Needs the user:** a Resend account and DNS records for invite emails (optional; without them the sender copies the link), and the P3b browser check below.

## Out of scope
Open sign-up, custom roles, legal details and logo, SSO, per-company billing, the live-payments request (P4), the full dashboard (P4d).
