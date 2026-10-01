# W — Public waitlist + private lead list (side phase, before P3)

Status: built and deployed 2026-10-01 (PR #4); live at https://kleeno.orclide.com. Approved by the user ("let's build this"); P3 keeps its Oct 4–5 slot.

## Goal
A public, SEO-friendly landing page that explains Kleeno honestly and collects waitlist sign-ups with a short survey (pain point, budget, call opt-in). Every unfinished page stays unreachable. A private admin area (team only) shows the leads, metrics, status, notes and follow-ups, and exports CSV. Purpose: find out who would pay, how much, and who to call; email them at launch with pricing and an early-access offer.
Not in scope: sending emails (no provider yet), showing prices, any change to the payroll engine, guard or payment paths.

## How it works
- **Visitor:** `/` → email + consent → saved → optional survey on the same page (3 questions + role, company, team size) → thank-you. A repeat email sees the same thank-you and changes nothing.
- **Admin:** `/<ADMIN_PATH>` → login (password, then authenticator code; the first sign-in enrols one) → metrics + searchable, filterable list → contact page (answers, status buttons, notes, next-action date, test flag, history, delete on request) → CSV export.

## Pages
| Who | Route | What |
|---|---|---|
| Public | `/` | Landing + waitlist + survey + FAQ (structured data) |
| Public | `/privacy` | What we store, why, where, how long, analytics, deletion |
| Public | any other URL | One branded 404 (same response for unknown, locked and internal paths) |
| Admin | `/<ADMIN_PATH>/login` | Password + TOTP |
| Admin | `/<ADMIN_PATH>` | Metrics, filters, list, CSV export |
| Admin | `/<ADMIN_PATH>/contacts/[id]` | One contact |
Machine files: `robots.txt` (public pages only, never the admin path), `sitemap.xml`, `opengraph-image`, `icon.svg`.

## Decisions
1. **`growth` schema** for all waitlist data, no `company_id` (ESSENTIALS rule 32 exception). Exposed to the API for `service_role` only; `anon`/`authenticated` have no USAGE and no grants; RLS on, no policies.
2. **Platform admin** = a row in `growth.platform_admins`, added only by `scripts/add-platform-admin.ts`. Admins always need MFA (aal2). Company roles grant nothing.
3. **Site lockdown, three walls:** (1) `src/proxy.ts` allows an exact path list unless `SITE_MODE=app` (missing = waitlist, fail closed); everything else gets the same 404; encoded traversal and `/admin*` are refused. (2) Every payroll page sits in the `(app)` route group whose layout 404s in waitlist mode; payroll API routes 404 via the guard's scope. (3) Those pages still need login + company role.
4. **Secret admin path:** `ADMIN_PATH` lives in env only (the repo goes public in P5). The proxy rewrites `/<ADMIN_PATH>/…` to the internal `/admin/…` and sets a gate header; admin pages and routes 404 without it. Admin responses send `noindex`, `no-store` and `Referrer-Policy: no-referrer`. The path is a curtain; login + MFA + allowlist are the lock.
5. **SEO:** server-rendered static landing page, one H1, keyword sections (AI payroll, payroll reconciliation, contractor payments, payroll audit trail), FAQ + FAQPage/Organization/WebSite JSON-LD, canonical, Open Graph image, sitemap, robots. Domain: `kleeno.orclide.com` for now (`SITE_URL`); a dedicated domain later is an env change + redirect.
6. **Survey (all optional):** Q1 biggest challenge, Q2 monthly budget band ("research only, not a price or commitment"), Q3 open to a 20-minute call. Budget alone never qualifies a lead.
7. **Consent:** one unticked, required box: "Email me when Kleeno is ready, including pricing and early-access offers. I can unsubscribe at any time." Stored with `consent_version` (2026-10-01) and time. No specific discount is promised.
8. **No overwrite by strangers:** first write wins. A survey token (32 random bytes, SHA-256 stored, 30 min, one use) is issued only for a new contact; repeat emails get a decoy token, so replies never reveal who joined.
9. **Abuse:** honeypot, ≥ 1.5 s fill time, DB rate limits on HMAC'd IP (and email for admin login). No captcha; Turnstile is a later option.
10. **Analytics:** Vercel Web Analytics (cookieless) on `/` and `/privacy` only. Visitors are reported separately from leads.
11. **Lead status:** NEW, QUALIFIED, CALL_SCHEDULED, CALL_DONE, PILOT_CANDIDATE, CLOSED, UNSUBSCRIBED; changed by named actions; free movement, each change in append-only `growth.contact_events`. Survey completion is separate.
12. **Retention:** until launch + 12 months or deletion on request (stated on `/privacy`; user confirmed 2026-10-01). Deletion is a hard delete; `growth.admin_events` records it without the email.
13. **Test data:** `is_test` (set by an admin) is excluded from every metric.

## Metrics (shown with their definitions)
Sign-ups (non-test) · survey completion = surveyed ÷ sign-ups · call opt-in = "yes" ÷ sign-ups · calls scheduled / done (current status) · pilot candidates, call → pilot = pilots ÷ (call done + pilots) · challenge and budget distributions over surveyed contacts · sources (utm_source, else referring site, else direct). Visitors: Vercel Analytics; sign-up rate = sign-ups ÷ unique visitors, by hand. No data → "No sign-ups yet".

## Deploy
Step-by-step runbook (access, email accounts, commit, Supabase prod, Vercel CLI, GitHub CLI, domain, checks, rollback, next waitlist work): `docs/phases/W-launch.md`. Post-deploy lockdown check: `npm run script -- scripts/probe-site.ts <url> --admin-var PROD_ADMIN_PATH`.

## Done when
1. `npm run lint`, `typecheck`, `test`, `test:invariants`, `build` → exit 0 (done 2026-10-01; payroll tests unchanged and green).
2. `npm run test:db` green on `kleeno-dev`, incl. `tests/db/growth.test.ts` (22 tests: sign-up, duplicates, concurrency, bots, token flow, combined form, skip, rate limit, lockdown, admin authz incl. MFA, actions, delete, CSV).
3. Unit: `tests/unit/growth.test.ts` (validation, metrics incl. empty data + `is_test`, CSV escaping).
4. Named check: production build in waitlist mode, `scripts/probe-site.ts` (44 checks: guessed URLs (payroll pages, `/admin`, encoded paths, extensions, API routes, `.env`) → 404; public pages 200; admin path → login with noindex + no-store) → all passed 2026-10-01.
5. Browser: sign-up + survey in a real browser saved correctly; admin login with TOTP enrolment, list, contact page, filters and CSV export work.
6. Playwright smoke: not added (Playwright is not installed until P5; covered by the browser check above).
7. User sees it in the browser; `PROGRESS.md` updated; one commit; PR; CI green; squash-merge.

### Security rows (`docs/security.md`)
S51–S58 (all `verified` by the tests and named check above).

## Deferred (`docs/roadmap.md`)
Prospects table, interaction log, structured interview notes, wider funnel analytics, budget × role, emails (confirmation, launch, unsubscribe link: needs a provider + a postal address in the footer for US law), Turnstile, multi-admin roles.
