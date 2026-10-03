# P4u — App shell + product UI (side phase, before P4 UI)

Status: **approved by the user 2026-10-03** ("the plan looks good"). Decisions below are the user's answers of 2026-10-03. Next after P4u: finish P4, then P4g Google sign-in (`P4g.md`).

## Why
The signed-in app uses `DESIGN.md`'s Mastercard *marketing-site* system: a cream editorial canvas, a floating pill nav and 20–40px radii. Its own text says the whitespace means "slow down, read one thing at a time — the opposite of dense dashboard UIs". Payroll professionals expect the layout of Gusto, Rippling, ADP, Notion and ClickUp: a left sidebar with modules, a slim top bar, and dense, quiet content. Every file in `awesome-design-md` (Notion, Stripe, Linear, Wise…) also describes a marketing site, so swapping brands would not fix this. Kleeno therefore gets two styles under one brand: the public site keeps Mastercard, and the app gets a product-UI section of its own.

## Decisions (user, 2026-10-03)
1. **Style: "Calm workspace".** White content, warm-grey sidebar, ink-black primary buttons, Sofia Sans kept, Signal Orange only for risk (rule 45). Hairline borders over shadows, 6–8px radii, 14px body, tabular figures for money.
2. **Timing: now**, on `p4-payments`, before the user's P4 browser check. P4 slice 7 UI (run approval, `/settlement`, admin live queue, wallet confirmation) already exists uncommitted, so P4u restyles it into the shell rather than rebuilding it, and the user checks P4 once, in the new shell. The P4d dashboard is then built on the shell. P4 backend is untouched.
3. **Top bar:** search (Ctrl+K) · notifications/to-dos · "Run payroll" button · SIMULATION/LIVE badge.
4. **Payroll-standard names:** Dashboard→Home, Runs→Pay runs, Settlement→Payments, Configuration→Pay policy. Workers, Exceptions and Import stay. URLs do not change.

## Layout
- **Sidebar (240px, collapses to icons, a drawer on mobile):** company switcher at the top · Home · PAYROLL: Pay runs, Exceptions (open count), Payments · PEOPLE: Workers, Import · SETUP: Pay policy, Team, Company · footer: Audit (P5), Account, sign out. Items show only for roles that can use them; the server still checks every action (rule 33).
- **Top bar:** breadcrumb/page title on the left; search, bell, "Run payroll" (roles that can create runs only) and the mode badge on the right.
- **Page frame:** title + one primary action, then content. Tables, steppers and side panels follow pages.md §5–6.
- **Without the shell:** login, invite, onboarding and select-company use a centred card layout.
- **Not touched in P4u (user, 2026-10-03):** the waitlist/landing page and `/privacy` are redesigned last, after everything else is finished. The 404 and the admin area also keep their current look.

## Tokens
- Values: canvas `#FFFFFF`, sidebar `#F7F7F5`, text `#141413`, muted `#5F5E5B`, hairline `#E9E9E7`, primary `#141413`, risk `#CF4500`, success/error proposed in the `DESIGN.md` §11 draft (rule 45).
- **Scoping:** the app theme is a CSS-variable override on the shell wrapper, so the public pages keep the Mastercard tokens with no change.
- Tokens only; no hex in components.

## Build
UI only, no Ponytail (rule 44). Order (user, 2026-10-03): login and other auth pages first, then the dashboard, then the other signed-in pages.
1. Doc edits: `DESIGN.md` §11 "Product UI" (applies to signed-in pages, overrides §1–9 there); ESSENTIALS rule 45 (radii and pill rules apply to public pages only); `docs/pages.md` navigation line + names; `FILE-STRUCTURE.md` for the new route group and components.
2. shadcn `sidebar`, `command`, `dropdown-menu`, `sheet`, `tooltip` and `badge`, themed by tokens.
3. Route group `(workspace)` with a shared layout (sidebar + top bar) for the 10 working pages. `AppNav` is removed from the pages. Auth-flow pages move to a `(auth)` centred layout. The waitlist lockdown layout still wraps both (W decision 3).
4. **Search:** a command palette over pages, recent runs and worker codes (W001…), loaded through existing server repositories scoped by session company + role. No names, no new API route if avoidable.
5. **Bell:** to-dos derived from existing data (run awaiting my approval, plan awaiting my signature, recipient change awaiting the other role, open exceptions), each with its reason and link. The P4d "My to-dos" reuses the same query.
6. Sweep the hard-coded `rounded-[2.5rem]`, `rounded-[1.25rem]`, `shadow-card` and pill classes on app pages and components (~150) to tokens. Shared public components are left alone.
7. The login card leaves room for the P4g "Continue with Google" button (not built here).
8. Check that Sofia Sans renders tabular figures (`tnum`). If it does not, use Inter for numeric cells only.

## Done when
1. `npm run lint`, `typecheck`, `test`, `test:invariants`, `build` → exit 0; no backend file changed except a read-only to-do/search query if needed (then `test:db` green).
2. Every signed-in page renders in the shell at 1440px and 390px; auth pages use the centred layout; no page imports `AppNav`.
3. The landing page, `/privacy` and the 404 look unchanged (before/after screenshots); waitlist mode still 404s every app page (probe script).
4. Ctrl+K opens search; bell counts match the data; "Run payroll" and nav items hide for roles without the permission; the server still refuses those actions.
5. Text contrast is WCAG AA; keyboard focus is visible; the sidebar collapse and mobile drawer work; motion follows `DESIGN.md` §10 and `prefers-reduced-motion`.
6. The user sees it in the browser together with the P4 UI and approves → `PROGRESS.md` updated. Commits on `p4-payments`: P4 first, then P4u as its own commit (agent default; one PR). P4's second-agent review covers backend only.

### Security rows
No new controls. Existing role checks (rule 33), RLS scoping (S-rows for repositories) and the site lockdown (S51–S58) must still pass. Search and the bell are read-only and never show names or amounts beyond what the role already sees.

## Timeline
About one day (Oct 3–4), overlapping P4 UI. If P4 runs late, the first item to cut is still motion polish (PRD §12).

## Progress (agent, 2026-10-03)
Built, uncommitted on `p4-payments`, waiting for the user to see it in the browser (Done when 6).

**Built**
1. Docs: `DESIGN.md` §11 "Product UI" (tokens, shell, status chips, accessibility; success green is **proposed**, awaiting the user's OK per rule 45), ESSENTIALS rule 45 (public vs product shapes), `docs/pages.md` navigation + payroll-standard names, `FILE-STRUCTURE.md` (route groups, `shell/`, `server/db/shell.ts`).
2. shadcn `sidebar`, `command`, `dropdown-menu`, `sheet`, `tooltip`, `badge`, `popover`, `dialog` (+ `cmdk`), themed by tokens. `input.tsx` was kept (custom `Input/Label/Select`); `use-mobile` rewritten with `useSyncExternalStore` (lint).
3. Tokens in `globals.css`: product values are an override on `html:has(.app-theme)` (portals included); new shape tokens `rounded-card/box/field/chip`, `--field-*` sizes, `panel` utility, motion tokens, reduced-motion rule. Public pages resolve the same tokens to the Mastercard shapes.
4. Route groups: `(app)/(auth)` (login, invite, onboarding, select-company; centred card, empty `#sso-slot` on login for P4g) and `(app)/(workspace)` (shell: company switcher, role-filtered grouped nav, collapse to icons, mobile drawer, top bar with breadcrumb, Ctrl+K, bell, "Run payroll", mode badge). The waitlist 404 layout `(app)/layout.tsx` still wraps both. `AppNav`, `CompanySwitcher` (old), `SignOutButton` removed. While MFA is still pending the layout renders no shell, so `/account` stays reachable for MFA set-up.
5. Search: Ctrl/Cmd+K palette over pages, 8 recent runs and worker codes; index loaded with the page through `server/db/shell.ts` (user-scoped client, session company + roles, no names or amounts), no API route.
6. Bell: to-dos for run awaiting my approval, plan awaiting my signature (not for the approver of that payroll), recipient change awaiting confirmation (not for the person who set it), open exceptions per run; the same query gives the sidebar's exception count. P4d's "My to-dos" can reuse `shellData`.
7. Sweep: every `rounded-[2.5rem]`, `rounded-[1.25rem]`, `shadow-card`, pill and `border-primary/50` on app pages and components moved to tokens; pages use `PageHeader` + `panel`. Names: Home, Pay runs (`/dashboard#pay-runs`), Payments, Pay policy. Public pages, admin and 404 files untouched.
8. Sofia Sans renders tabular figures: measured in Chrome, "1111", "0000" and "8888" are the same width under `tabular-nums` (and differ without), so no Inter fallback. `td`, `th` and `.tabular` use it in the product theme.

**Checked** (Chrome via Playwright against `next dev`, dev-company logins from `.env`): login and 9 working pages at 1440px and 390px; no horizontal overflow; drawer, collapse, Ctrl+K, bell, role filtering (payment approver sees no Exceptions, Import, Pay policy or "Run payroll"); keyboard focus ring visible; landing page and `/privacy` pixel-identical to before (full-page diff, 0 pixels). New `tests/db/shell.test.ts` (8 tests: role scoping, four-eyes exclusion, isolation, no names or amounts, soft failure).

**Not verified / for the user's eyes**
- Success green (`#1E6B45` on `#E8F3EC`) needs the user's approval (rule 45).
- Not seen in a browser: `select-company`, `onboarding`, `invite`, the run page in states other than "simulation complete", the settlement plan/sign/pay panels with a live run (no live run in the dev data), a LIVE badge, worker panels opened. They use the same tokens and were swept by class, so look for odd spacing there.
- Contrast was computed by hand (AA for muted, risk, success, field border); no automated axe run.
- The 404 page was not re-compared (signed-out app mode redirects to login; it needs waitlist mode). Its file and the Mastercard tokens are unchanged.
- `/settings/company` logs a React hydration warning from the country/time-zone `<select>` (P3b `company-form.tsx`, options from `Intl` differ between server and browser). Fixed after the browser check (2026-10-03): the server pages pass the lists to `BasicsForm` as `options`. Also fixed then: the company-switcher label now sits in a `DropdownMenuGroup` (base-ui needs it), and `<html>` has `suppressHydrationWarning` (a browser extension, QuillBot, adds attributes before hydration).
- `navFor` in `src/server/auth/page-session.ts` is now unused (backend file, left alone).
