# Progress

Read first; update at the end of every session. Keep ≤ 30 lines.

- **Phase:** P0 Setup — scaffold verified; first commit + private repo `Ivan-Ryukendo/kleeno` created 2026-09-30; awaiting CI result.
- **Done:** Next.js 16 + TS strict + Tailwind 4 + shadcn/ui, `src/server/env.ts` (checked at startup via `src/instrumentation.ts`), Vitest, Foundry project in `contracts/` (forge-std submodule), Supabase CLI init, CI workflow, `.claude/settings.json`. Done-when 1–9 and 11 pass locally (build, lint, tsc, test, forge build/test, supabase --version, gitignore, env.example, missing-env error, placeholder page).
- **Local tooling (inside the project; only Node/git live on C:):** `.npm-cache/` (npm cache via `.npmrc`), `.tools/foundry` (forge 1.8.3), `.tools/solc` (0.8.37). Both git-ignored. In each new shell: add `.tools\foundry` to PATH and set `FOUNDRY_SOLC=<repo>\.tools\solc\solc.exe` before running `forge`.
- **Also done:** gitleaks 8.30.1 in `.tools/gitleaks/` (checksum-verified; add to PATH per shell); staged scan clean; #15 passes.
- **Not yet done:** #10 CI green, #12 Ponytail-off check in a fresh session (user), #13 confirm both Supabase projects exist with sign-up off and GitHub email-privacy settings. `.env` (not `.env.local`) holds Supabase URL, service-role key and OpenRouter key.
- **Next step:** CI green → write `docs/phases/P1.md` for user approval. P1 needs the Circle TEST API key.
- **Design:** `DESIGN.md` added and wired into the docs (ESSENTIALS rule 45, CLAUDE.md read order, FILE-STRUCTURE). Not yet applied in code: scaffold still uses the default shadcn theme + Geist; P1 UI step must set the tokens and Sofia Sans in `globals.css`/`layout.tsx` first.
- **Security layer (2026-09-30):** planned in `docs/security.md` (data protection model, controls S01–S45 by phase + test, secret inventory, emergency stop, deferred, accepted risks). User decisions: public DB API read-only, writes only via server repositories (rule 32); kill switch OFF in UI, ON by script only (rule 17); re-auth only for authority-granting actions (rule 47); field encryption AES-256-GCM per company (S41, rule 50); TOTP MFA for real-company users (S43); passphrase-encrypted name key file (S42). New ESSENTIALS rules 46–50. `middleware.ts` -> `proxy.ts` (Next 16). S37 test passing. Every `Pn.md` copies its phase's rows.
- **Pages:** `docs/pages.md` (13 pages, landing page, intended feel), draft awaiting user approval.
- **Integrations (2026-09-30):** designed in `docs/integrations/` + `docs/decisions/` (4 ADRs); ESSENTIALS rules 51–55; ARCHITECTURE §24; security rows S46–S50. User decision: foundation only in the hackathon (P3: provenance, capabilities, `csv_upload` source, tests S46–S48); connectors, read-only MCP, journal export -> roadmap Next. Open before the first HRIS connector: names vs rule 35.
- **Git/GitHub (2026-09-30):** workflow in `docs/github.md` (ESSENTIALS rule 56): noreply commit email set repo-locally, staged gitleaks + checks before each commit, phase branch -> PR -> green CI -> squash-merge, going-public checklist + hosting checks in P5. P0 still needs `.tools/gitleaks/` and the user's GitHub email-privacy settings.
- **Open decisions:** DB-tests CI job in P0 or P2 (agent suggests P2).
- **Stuck reports:** —
- **Side task (not build):** pilot outreach, consent template, data note — run by the user alongside the build.