# P4g — Google sign-in (after P4 merges, before P4c)

Status: draft 2026-10-03. Timing (user, 2026-10-03): straight after P4, before the hackathon deadline. Decisions below are agent defaults; the user confirms them before the build starts.

## Goal
An invited user can sign in with "Continue with Google" instead of email + password. Invite-only access, MFA, re-auth, four-eyes and the site lockdown all still hold. Microsoft sign-in is the same pattern and comes later (decision 7).

## Flow
Login page → "Continue with Google" → server starts Supabase `signInWithOAuth` (PKCE, scopes `openid email profile` only) → Google → Supabase → `/auth/callback` → code exchanged for a session on the server → checks below → MFA step if needed (aal2) → select-company or Home.

Callback checks, in order:
1. A PKCE code exchange that fails, has expired or has already been used → back to `/login` with the login-failure message.
2. Supabase refuses unknown emails because sign-up is off. Any account that still has no membership is signed out and gets the same calm "no access, request access on the home page" message (no account enumeration).
3. MFA is enforced exactly as for passwords: a verified factor or an `mfa_required` company means aal2 before any page (session.ts rules unchanged).
4. The post-login destination comes only from an allow-list of relative app paths. Anything else → Home, so there is no open redirect.
5. Success and failure are recorded as auth events with a correlation ID. Tokens and Google profile data are never logged (S45).

## Decisions (defaults; confirm before the build)
1. **Who can use it:** existing accounts only. An invited user accepts the invite as today (sets a password), then may use Google if the Google email matches. Supabase links a Google identity to an existing account with the same verified email automatically. **Spike first on `kleeno-dev`:** confirm (a) with sign-up off, an unknown Google email is refused, and (b) a matching email links to the existing user and keeps the same user ID. If either fails, stop and ask (stuck rule).
2. **"Accept invite with Google"** (no password at all) is slice 2 and can be cut. It needs: the invite token held in a short-lived signed, httpOnly cookie across the redirect; the Google email must equal the invite email (S62); the account is created by the server (admin API, email confirmed) just before the redirect.
3. **Re-auth without a password (only if slice 2 ships):** rule 47 becomes "password, **or** a fresh authenticator code for accounts with a verified TOTP factor". It reuses `requireTotp` from P4 slice 4, with the same throttle (`REAUTH_FAILED`) and audit. An account with neither a password nor a factor cannot approve or sign; the UI tells it to add a code on `/account`.
4. **Admin area stays password + TOTP only.** The admin guard also requires `password` among the session's sign-in methods (the JWT `amr` claim). A Google session never reaches `/<ADMIN_PATH>`, even for a platform admin.
5. **Waitlist mode:** `/auth/callback` is allowed by the proxy only when `SITE_MODE=app`; in waitlist mode it returns the same 404 as every other app path (S51–S58). The probe script gains this URL.
6. **Account page:** shows the linked sign-in methods (password, Google). Unlinking is later.
7. **Microsoft (Entra ID)** uses the same callback and checks. It is not in P4g; add it after the hackathon, or in P4g only if the user asks and time allows. SAML/SSO (Supabase paid plan) is roadmap.

## Build (backend first with Ponytail `full`, UI after without it)
Before coding: read the current Supabase docs for `signInWithOAuth` + `exchangeCodeForSession` with `@supabase/ssr`, and the Next.js route-handler guide in `node_modules/next/dist/docs/` (this Next version differs from training data).
1. Spike (decision 1) on `kleeno-dev`.
2. `src/server/auth/oauth.ts` (start + callback checks), `src/app/auth/callback/route.ts` (thin handler), proxy allow-list, admin `amr` check, auth events.
3. `supabase/config.toml` `[auth.external.google]` with `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"` (no secret in git); the Redirect URLs allow-list on dev and prod.
4. UI: the Google button on the P4u login card (Google's brand rules: official "G" mark, "Continue with Google"); linked methods on `/account`.
5. Slice 2 (cut-able): invite accept with Google + the rule 47 TOTP alternative.
6. Doc edits: ESSENTIALS rule 47 (only if slice 2 ships), `docs/pages.md` rows 3, 5 and 14, `FILE-STRUCTURE.md`, `docs/security.md` S74–S75, `.env.example` (variable name only).

## User checklist
- [ ] Google Cloud: a project, OAuth consent screen (External; name Kleeno; support email; authorized domain `orclide.com`; privacy policy `https://kleeno.orclide.com/privacy`; scopes email, profile, openid only), then **Publish** (basic scopes need no Google review; in "Testing" only listed test users can sign in).
- [ ] An OAuth client (Web application) with redirect URI `https://<project-ref>.supabase.co/auth/v1/callback` for **each** of `kleeno-dev` and `kleeno-prod`.
- [ ] Paste the client ID and secret into Supabase → Authentication → Providers → Google yourself (dev and prod). Keep "Allow new users to sign up" **off**.
- [ ] Supabase → URL Configuration: add `http://localhost:3000/auth/callback` (dev) and `https://kleeno.orclide.com/auth/callback` (prod).
- [ ] Confirm decisions 1–7, and where Google sign-in sits in the cut order (PRD §12).

## Done when
1. `npm run lint`, `typecheck`, `test`, `test:invariants`, `test:db`, `build` → exit 0; CI green.
2. Unit: the redirect allow-list (absolute URLs, `//host`, encoded paths → Home); callback error paths → `/login` with the generic message.
3. DB: a Google session for an account without a membership is signed out and refused; an `mfa_required` company still needs aal2 after Google sign-in; a Google-only session is refused by the admin guard; slice 2 if built: re-auth by TOTP → wrong code 401, throttled, audited, nothing changed.
4. Probe: `/auth/callback` → 404 in waitlist mode.
5. Browser on dev: an invited account signs in with Google and lands on its company; an unknown Google account gets the calm refusal; the user sees it and approves.
6. Security rows `verified` (or `unverified` with a reason); `PROGRESS.md` updated; one commit on `p4g-google-auth`; PR; CI green; squash-merge.

### Security rows (`docs/security.md`)
S74 · S75 (slice 2 only). S15, S43, S51–S58, S62 must still pass.

## Timeline
About half a day for slice 1 and half a day for slice 2, right after P4 merges (~Oct 4–5). PRD §12 dates for P4c onward shift by up to a day.
