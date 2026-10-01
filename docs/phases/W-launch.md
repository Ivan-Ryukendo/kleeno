# W launch runbook: publish the waitlist site, then the next waitlist work

For the next session. Do the parts in order. Each step names who does it: **USER** (needs a browser, a password or a decision) or **AGENT** (Claude Code runs it). Spec of what was built: `docs/phases/W.md`. Git rules: `docs/github.md`.

## State on 2026-10-01
- Branch `w-waitlist`: built and tested, **NOT committed**. Nothing is deployed. `kleeno-prod` has no schema yet.
- Dev data: `kleeno-dev`, schema `growth` (tables `contacts`, `surveys`, `survey_tokens`, `contact_events`, `admin_events`, `rate_limits`, `platform_admins`). 1 real test sign-up (the user's duck.com address).
- Dev admin: the user's `ADMIN_EMAIL` is a platform admin on `kleeno-dev` (granted 2026-10-01). TOTP not yet enrolled.
- Checks passed: lint, typecheck, unit + invariants 124, db 89 (growth 22), `scripts/probe-site.ts` against a local waitlist-mode production build: 44/44.
- CLIs: `gh` logged in as `Ivan-Ryukendo`. `vercel` 53.1.0 logged in (`vercel whoami` = `gamalnassergfxvercel-2300`; confirm with the user that this is the intended Vercel account before `vercel link`). Supabase CLI is linked to `kleeno-dev`.
- `.env` checked 2026-10-01: all values for Parts 3–4 present. `SUPABASE_PROD_ANON_KEY` verified against prod (200). Prod DB password verified (connects; 9 migrations pending, none applied). The user was asked to reset the prod DB password after it was echoed once; if `db push` fails with an auth error, the new password is not in `.env` yet.

## Rules for the agent (every step)
- Never put a secret in a command **argument**: `npx`/`npm run` echo their arguments ("npm notice run …"), which leaked the prod DB password once (2026-10-01). Pass secrets through env vars or stdin only.
- Never print secret values in chat or command output. Read them from `.env` inside the command (`val NAME`, below) and pipe them into the CLI. `ADMIN_PATH` and `PROD_ADMIN_PATH` count as secrets.
- Never stage `.env*` (except `.env.example`), `.vercel/`, `.agents/`, `.claude/skills/`, `skills-lock.json`.
- Production (`kleeno-prod`, Vercel Production) changes only in Part 3 and 4, in the order given. If a step fails: stop, do not improvise on prod, report the error and 2 options (CLAUDE.md stuck rule).
- Bash helper used below (Git Bash; strips Windows line endings):
  ```bash
  val() { grep -m1 "^$1=" .env | cut -d= -f2- | tr -d '\r'; }
  ```

---

## Part 1. Access (reference)

### 1.1 Admin page
| | Local (dev data) | Production (real leads) |
|---|---|---|
| URL | `http://localhost:3000/<ADMIN_PATH>` | `https://kleeno.orclide.com/<PROD_ADMIN_PATH>` (until DNS works: the `*.vercel.app` production URL + `/<PROD_ADMIN_PATH>`) |
| Where the path is | `.env` line `ADMIN_PATH=` | `.env` line `PROD_ADMIN_PATH=` (created in 3.1) and the user's password manager |
| Login | `ADMIN_EMAIL` + `ADMIN_PASSWORD` from `.env` | same email + password (account created on prod in 3.4) |
| Second factor | authenticator app; first sign-in shows a QR code to scan | separate enrolment on prod (different database) |

- Start locally: `npm run dev` (uses `SITE_MODE=app` from `.env`; the admin path works in both modes). Waitlist-only view in PowerShell: `$env:SITE_MODE="waitlist"; npm run dev`.
- Open the local admin login without copying the path (PowerShell, project folder, dev server running):
  `$p = (Select-String -Path .env -Pattern '^ADMIN_PATH=(.+)$').Matches[0].Groups[1].Value.Trim(); Start-Process "http://localhost:3000/$p/login"`
  For production use `PROD_ADMIN_PATH` and `https://kleeno.orclide.com`.
- `/admin` always answers 404. That is intended.
- Forgot password: USER edits `ADMIN_PASSWORD` in `.env`; AGENT runs `npm run script -- scripts/add-platform-admin.ts --reset-password` (add `--prod` for production).
- Lost phone / authenticator: AGENT runs `npm run script -- scripts/add-platform-admin.ts --reset-mfa` (add `--prod`). Next sign-in shows a new QR code.
- Remove an admin: `... add-platform-admin.ts --remove` (with the email in `ADMIN_EMAIL`).
- Path leaked: set a new random value (`openssl rand -hex 16`) in `.env` and in Vercel (`ADMIN_PATH`), redeploy. Login + MFA still protect the data.

### 1.2 Email accounts (three different things)
1. **Admin login email** (`ADMIN_EMAIL`): only for signing in to the admin page. Already set.
2. **Contact mailbox** (`CONTACT_EMAIL`): shown on `/privacy` for deletion requests. **Needed before publishing.** Recommended: `kleeno@orclide.com` forwarding to the user's Gmail (no new inbox to check).
   - orclide.com is at **Namecheap** (nameservers `dns1/dns2.registrar-servers.com`) and already uses Namecheap Email Forwarding (MX `eforward1-5.registrar-servers.com`, checked 2026-10-01). So no DNS change is needed.
   - USER: Namecheap → Domain List → `orclide.com` → Manage → **Mail Settings** (stays "Email Forwarding") → Add forwarder: alias `kleeno` → forward to the user's Gmail → Save.
   - USER: send a test email to the new address and confirm it arrives in Gmail. Then add `CONTACT_EMAIL=kleeno@orclide.com` to `.env`.
   - If the user prefers no forwarding yet: use a Gmail address they are happy to publish. Do not publish without a contact email.
3. **Sending account** (for alerts, confirmations and the launch email, Part 6). **Not needed to publish.** Recommended: Resend.
   - USER: sign up at resend.com with the Gmail address → Domains → Add `kleeno.orclide.com` → add the DNS records Resend shows (MX + SPF TXT on `send.kleeno`, DKIM TXT on `resend._domainkey.kleeno`) at the orclide.com DNS host → wait for "Verified". Also add `_dmarc.orclide.com` TXT `v=DMARC1; p=none;` if none exists.
   - USER: API Keys → create key, permission "Sending access", domain `kleeno.orclide.com` → paste into `.env` as `RESEND_API_KEY=` (never in chat).
   - USER: decide the sender (e.g. `Kleeno <hello@kleeno.orclide.com>`) and a postal address for email footers (required by US CAN-SPAM; a PO box or virtual address is fine).

---

## Part 2. Before publishing: decisions + commit

### 2.1 USER decisions (AGENT asks with AskUserQuestion, all in one call)
1. Keep sign-ups until launch + 12 months (decided 2026-10-01; `/privacy` says so)? If another period: AGENT edits `src/app/(public)/privacy/page.tsx` and W.md decision 12.
2. `CONTACT_EMAIL` ready (1.2.2)?
3. Approve the protected-test change in `tests/invariants/security/app-structure.test.ts` (3 public routes added to the open-route list + new S52 scope check)? Rule 39 needs this approval. If no: stop and discuss.
4. Has the user signed in to the local admin page and seen the landing page working? (CLAUDE.md: commit only after the user has seen it.)

### 2.2 AGENT: commit on `w-waitlist`
1. `git branch --show-current` → `w-waitlist`. `git config user.email` → `107222682+Ivan-Ryukendo@users.noreply.github.com`.
2. Run checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:db`. All must pass.
3. Stage: `git add -A -- . ':!.agents' ':!.claude/skills' ':!skills-lock.json'`, then `git status` and `git diff --cached --name-only`. No `.env` except `.env.example`, no `.vercel/`.
4. Secret scan: `export PATH="$PWD/.tools/gitleaks:$PATH"; gitleaks git --pre-commit --staged -v` → "no leaks found".
5. Set W security rows to `verified` if not already; update `PROGRESS.md` (W line: committed). Re-stage.
6. Commit:
   ```text
   W: public waitlist, SEO landing page and private lead list

   <3-5 plain lines: landing + survey, lockdown, secret admin with MFA, growth schema, tests>

   Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
   ```
7. `git push -u origin w-waitlist`, then `gh pr create --base main --head w-waitlist --title "W: public waitlist, SEO landing page and private lead list" --body-file <file>` (body: summary, test results, deploy note, ends with the Claude Code line from the session's attribution reminder). Call `link_pull_request` with the PR URL.
8. `gh pr checks --watch`. CI must be green. **Do not merge yet**: production must be ready first (Part 3), because the merge deploys.

---

## Part 3. Production setup (once)

### 3.1 AGENT: generate production secrets into `.env` (values never shown)
```bash
grep -q '^PROD_ADMIN_PATH=' .env || printf '\nPROD_ADMIN_PATH=%s\n' "$(openssl rand -hex 16)" >> .env
grep -q '^PROD_DATA_ENCRYPTION_KEY=' .env || printf 'PROD_DATA_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)" >> .env
```
USER: copy both values from `.env` into the password manager now. Losing `PROD_DATA_ENCRYPTION_KEY` later means losing encrypted payroll data (none exists yet).

### 3.2 USER: values only the user can get (paste into `.env`, never in chat)
- `SUPABASE_PROD_ANON_KEY=`: Supabase → `kleeno-prod` → Project Settings → API Keys → the **publishable** key.
- `SUPABASE_PROD_DB_PASSWORD=`: the `kleeno-prod` database password. If unknown: Project Settings → Database → Reset database password.
- `CONTACT_EMAIL=` (1.2.2).

AGENT checks presence only: `for n in SUPABASE_PROD_URL SUPABASE_PROD_SERVICE_ROLE_KEY SUPABASE_PROD_ANON_KEY SUPABASE_PROD_DB_PASSWORD SUPABASE_ACCESS_TOKEN CONTACT_EMAIL PROD_ADMIN_PATH PROD_DATA_ENCRYPTION_KEY OPENROUTER_API_KEY; do [ -n "$(val $n)" ] && echo "ok $n" || echo "MISSING $n"; done`

### 3.3 AGENT: Supabase `kleeno-prod`
```bash
PROD_REF=$(val SUPABASE_PROD_URL | sed -E 's#https://([^.]+)\..*#\1#')
DEV_REF=$(cat supabase/.temp/project-ref)
API=https://api.supabase.com/v1/projects; AUTH="Authorization: Bearer $(val SUPABASE_ACCESS_TOKEN)"
q() { curl -s -H "$AUTH" -H "Content-Type: application/json" -X POST "$API/$PROD_REF/database/query" -d "{\"query\":\"$1\"}"; }
```
1. **Backup check:** prod must still be empty. `q "select count(*) from information_schema.tables where table_schema in ('public','growth')"` → `0`. If not 0: stop and ask the user (follow the backup procedure in `docs/security.md` before any change).
2. **Migrations** (password via the `SUPABASE_DB_PASSWORD` env var, never as an argument):
   ```bash
   export SUPABASE_DB_PASSWORD="$(val SUPABASE_PROD_DB_PASSWORD)"
   npx supabase link --project-ref "$PROD_REF"
   npx supabase db push --dry-run     # must list all 9 files, 20260930000001 … 20261001000001
   npx supabase db push               # never --include-seed
   ```
3. **Link back to dev immediately:** `export SUPABASE_DB_PASSWORD="$(val SUPABASE_DB_PASSWORD)"; npx supabase link --project-ref "$DEV_REF"`. Confirm `cat supabase/.temp/project-ref` = dev, then `unset SUPABASE_DB_PASSWORD`.
4. **Expose `growth` to the API:** `curl -s -H "$AUTH" $API/$PROD_REF/postgrest` (read `db_schema`), then `curl -s -H "$AUTH" -H "Content-Type: application/json" -X PATCH $API/$PROD_REF/postgrest -d '{"db_schema":"public,graphql_public,growth"}'`.
5. **Auth settings (P2.md checklist, S43):** `curl -s -H "$AUTH" $API/$PROD_REF/config/auth` and check, then PATCH only these keys: `{"disable_signup":true,"password_min_length":12,"mailer_autoconfirm":false,"mfa_totp_enroll_enabled":true,"mfa_totp_verify_enabled":true}`. Keep the Email provider enabled (password login needs it). Do the same on `DEV_REF` if not already set. If a key name is rejected, read the current Supabase Management API docs; do not guess.
6. **Verify:** `q "select count(*) from growth.contacts"` → `0`; `q "select count(*) from supabase_migrations.schema_migrations"` → the number of files in `supabase/migrations/`.

### 3.4 AGENT: production admin account
`npm run script -- scripts/add-platform-admin.ts --prod` → "admin on kleeno-prod".

### 3.5 USER + AGENT: Vercel project (Vercel CLI)
1. USER: in a PowerShell window in the project folder: `vercel login` (log in with GitHub as `Ivan-Ryukendo`). AGENT confirms with `vercel whoami`.
2. AGENT: `vercel link --yes --project kleeno`. Check `.gitignore` still ignores `.vercel` (the CLI adds it; if it did not, add `.vercel` and commit it with the next change).
3. AGENT: Production environment variables (values piped, never printed). `SITE_MODE` stays **unset** (= waitlist only).
   ```bash
   add() { printf '%s' "$2" | vercel env add "$1" production --yes >/dev/null 2>&1 && echo "set $1" || echo "FAILED $1"; }
   add SUPABASE_URL "$(val SUPABASE_PROD_URL)"
   add SUPABASE_SERVICE_ROLE_KEY "$(val SUPABASE_PROD_SERVICE_ROLE_KEY)"
   add NEXT_PUBLIC_SUPABASE_URL "$(val SUPABASE_PROD_URL)"
   add NEXT_PUBLIC_SUPABASE_ANON_KEY "$(val SUPABASE_PROD_ANON_KEY)"
   add DATA_ENCRYPTION_KEY "$(val PROD_DATA_ENCRYPTION_KEY)"
   add OPENROUTER_API_KEY "$(val OPENROUTER_API_KEY)"
   add WAITLIST_SECRET "$(openssl rand -base64 32)"
   add ADMIN_PATH "$(val PROD_ADMIN_PATH)"
   add SITE_URL "https://kleeno.orclide.com"
   add CONTACT_EMAIL "$(val CONTACT_EMAIL)"
   vercel env ls production
   ```
   `vercel env ls production` must list exactly these 10 names and no `SITE_MODE`. Do not add anything to Preview or Development.
4. AGENT: connect GitHub so merges to `main` deploy: `vercel git connect https://github.com/Ivan-Ryukendo/kleeno.git`. (`vercel.json` makes pushes to other branches skip the build.) If it fails with a permission error: USER opens Vercel → project `kleeno` → Settings → Git → Connect Git Repository → installs the Vercel GitHub app for `Ivan-Ryukendo/kleeno` only; then AGENT reruns the command.
5. USER: Vercel dashboard → project `kleeno` → Analytics → Enable (Web Analytics, free tier). Settings → Deployment Protection: leave the default (Standard Protection).
6. Note: Vercel Hobby is for non-commercial use. Fine for the hackathon waitlist; move to Pro before paying customers (`docs/github.md`).

---

## Part 4. Publish

### 4.1 Path A (default): GitHub CLI merge → Vercel deploys
1. AGENT: `gh pr checks --watch` green, then `gh pr merge --squash --delete-branch`.
2. AGENT: `git checkout main && git pull`. Watch the deploy: `vercel ls kleeno` until the newest Production deployment is `Ready` (if `Error`: `vercel inspect <url> --logs`, stop and report).
3. Note the production URL from `vercel ls` / `vercel inspect` (e.g. `kleeno-<hash>.vercel.app` alias `kleeno.vercel.app` if free).

### 4.2 Path B (manual / emergency only): Vercel CLI deploy
Use only when GitHub is unavailable or for a redeploy. Always from a clean, up-to-date `main` so production = `main`:
```bash
git checkout main && git pull && git status --short   # must print nothing
vercel deploy --prod
```
`.vercelignore` keeps `.env*` and local tooling out of the upload. Never deploy from a feature branch or a dirty tree.

### 4.3 Domain `kleeno.orclide.com`
1. AGENT: `vercel domains add kleeno.orclide.com kleeno`, then `vercel domains inspect kleeno.orclide.com` and give the user the exact DNS record shown.
2. USER: at the orclide.com DNS host add: Type `CNAME`, Name `kleeno`, Value = what Vercel showed (usually `cname.vercel-dns.com`), TTL auto. If the host is Cloudflare: proxy OFF (grey cloud).
3. AGENT: wait, then `nslookup kleeno.orclide.com` and `curl -sI https://kleeno.orclide.com` → `200`. HTTPS certificate is automatic.

### 4.4 Checks after deploy (all must pass)
1. AGENT: `npm run script -- scripts/probe-site.ts https://kleeno.orclide.com --admin-var PROD_ADMIN_PATH` → "all checks passed" (use the vercel.app URL if DNS is not live yet).
2. USER, in a private browser window:
   - Open the site; join with a test address; answer the survey.
   - Open `https://kleeno.orclide.com/<PROD_ADMIN_PATH>`; sign in; scan the new QR code (name it "Kleeno prod" in the app); see the test sign-up; open it; click **Test** (or Delete).
   - Try `/dashboard`, `/login`, `/admin`: all show "page not found".
3. AGENT: view-source check: `curl -s https://kleeno.orclide.com | grep -o '<title>[^<]*</title>\|rel="canonical"[^>]*\|application/ld+json' | head` (title, canonical to `https://kleeno.orclide.com`, JSON-LD present). `curl -s https://kleeno.orclide.com/robots.txt` must not contain the admin path.
4. USER: Google Search Console → Add property → **Domain** `orclide.com` (covers the subdomain) → add the TXT record it shows at the DNS host → Verify → Sitemaps → submit `https://kleeno.orclide.com/sitemap.xml` → URL inspection on `https://kleeno.orclide.com/` → Request indexing.
5. AGENT: update `PROGRESS.md` (W: live at URL, date) and W.md status. Commit on a `fix-w-launch` branch only if files changed, via PR.

### 4.5 Rollback
- Fast: `vercel rollback` (back to the previous production deployment), or `vercel promote <older-deployment-url>`.
- Clean: `gh pr create` with `git revert` of the merge commit, merge it (redeploys).
- The `growth` schema can stay; it touches no payroll table.
- At P5: `vercel env add SITE_MODE production` with value `app`, then redeploy, to open the payroll app for judges.

---

## Part 5. Updating the site later (both CLIs)
1. Branch from `main` (`fix-<topic>` or the phase branch) → change → checks (`docs/github.md` §3) → user sees it locally.
2. `git push` → `gh pr create` → `link_pull_request` → `gh pr checks --watch` → `gh pr merge --squash --delete-branch`.
3. `vercel ls kleeno` until Ready → `scripts/probe-site.ts` against production.

---

## Part 6. Next waitlist work (after it is live; each item: short plan in this file → user approves → build → tests → probe)
Order: 6.1 → 6.2 → 6.3 → 6.4. 6.5+ when needed. Backend uses the `ponytail` skill; UI follows `DESIGN.md`. Sending any email needs the Resend account (1.2.3) **and** explicit user approval of the email text.

1. **New sign-up alert to the team.** Email to `CONTACT_EMAIL` via Resend when a *new* contact joins: "New waitlist sign-up (#N). Open the admin page." No lead email, no admin path in the message. Send with `after()` from `next/server` so the reply and its timing are identical for new and repeat emails (S54). A failure is logged without PII and never fails the sign-up. Env: `RESEND_API_KEY`, `EMAIL_FROM` in `env.ts` (optional; feature off when unset), `.env.example`, `docs/security.md` §2. Test: db test with a fake sender (new → 1 alert, repeat → 0).
2. **Unsubscribe.** Public `/unsubscribe?t=<token>` page + `POST /api/waitlist/unsubscribe`. Token = random 32 bytes per contact, stored hashed (new column via migration), never expires. Sets status `UNSUBSCRIBED` through `growth.set_status` with an event row; idempotent; same reply for unknown tokens. Add both paths to `WAITLIST_PATHS` in `src/proxy.ts` and to `PUBLIC` in `scripts/probe-site.ts`; add an S-row. Emails carry `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
3. **"You're on the list" confirmation email** to new contacts only. Footer: sender, postal address, unsubscribe link. Update `/privacy` (Resend as email processor) and bump `CONSENT_VERSION` only if the consent text changes.
4. **Launch email.** Script `scripts/export-audience.ts` (or admin CSV): contacts with `is_test=false` and status not `UNSUBSCRIBED` → Resend Audience. The user writes/approves the text (pricing + early-access discount). Unsubscribes in Resend are copied back to `UNSUBSCRIBED` before every send.
5. **Converted + early-access code** (at product launch): migration adds status `CONVERTED` and `early_access_code`; when a waitlist email creates a Kleeno account, link the contact to the company; admin metric "converted ÷ sign-ups".
6. **Add a contact by hand** in the admin (people met at events): source `manual`, no marketing consent → excluded from 6.3/6.4 until they join themselves. Needs a migration (consent fields nullable for manual rows).
7. **Cloudflare Turnstile** on the form, only if bot sign-ups appear in the admin list.
8. **Playwright smoke** of sign-up + survey at P5 (Playwright arrives then).
9. **Prospects + interaction log + interview notes** (roadmap Next; not before the hackathon deadline unless the user asks).

## Done when (publish)
- PR merged with green CI; production deployment Ready; `kleeno.orclide.com` serves HTTPS.
- `probe-site.ts` against production: all checks passed.
- User signed in to the production admin with MFA and saw their test sign-up.
- Sitemap submitted in Search Console. `PROGRESS.md` updated.
