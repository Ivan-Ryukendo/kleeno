# Kleeno — Agent Guide

AI-assisted payroll for workers (employees and contractors): configuration, reconciliation and USDC settlement on Arc testnet. Global by design; first market US firms paying remote contractors. Tameion Agents Hackathon, deadline Oct 10 2026, 11:59 PM ET. The user is architect and product owner (not a coder); agents write all code.

## Read order
1. `PROGRESS.md`: where the build stands.
2. `ARCHITECTURE-ESSENTIALS.md`: all rules + precedence. Every session.
3. `PRD.md`: scope, demo, acceptance criteria, timeline, cuts.
4. `ARCHITECTURE.md`: the sections your phase touches.
5. `FILE-STRUCTURE.md`: where things go; phase deliverables.
6. `docs/phases/Pn.md`: current phase "Done when" checks.
7. `docs/security.md`: security controls for your phase (IDs, tests, status). Read before writing `Pn.md` or touching auth, DB, payments, AI inputs, imports, webhooks or secrets.
8. `docs/pages.md` + `DESIGN.md`: page map, landing page and intended feel; read both before any UI work (pages, components, `globals.css`, layout, styling, copy tone). Skip for backend-only tasks. Adaptations: ESSENTIALS rule 45.
9. `docs/integrations/README.md`: before touching imports, provenance, webhooks or anything external (connectors, MCP, notifications, SSO).
10. `docs/github.md`: before any commit, push, PR, merge, tag or visibility change.

On conflict: stop and ask the user.

## Architecture
AI proposes; deterministic code calculates; humans approve; PayrollGuard pays only committed obligations; Arc receipts verify; everything is audited.
Security layer: public DB API read-only (writes only via server repositories) · one payment gate · owner/operator split · kill switch · re-auth for authority-granting actions · immutable approved records · DB-backed idempotency. Controls S01–S50 with tests: `docs/security.md`.
Integrations: external systems are evidence sources or destinations, never authorities; code asks for capabilities, not vendors; every import carries provenance; CSV is the first source; connectors and a read-only MCP come after the hackathon (`docs/integrations/`, `docs/decisions/`).
Flow: policy -> AI rules -> validation -> HR approval -> CSV import (anonymised in browser, USD only) -> reconciliation + exceptions -> engine + trace -> payroll approval -> obligations -> Payment Planner (AI) proposes batch + holds -> payment approver signs plan (different user), or a standing authorization signs a clean batch -> openRun on PayrollGuard -> gate -> payment agent -> Circle wallet -> PayrollGuard.pay on Arc -> settlement reconciliation -> audit.
Modes: `SIMULATION` (default, never pays), `LIVE_TESTNET`. Pay types: `SALARIED`, `HOURLY`, `RETAINER`.
Layers: `src/core` pure domain -> `src/server` adapters -> `src/app` pages + thin handlers; `contracts/` Foundry guard.

## Tech stack
Next.js App Router (TS strict), Tailwind + shadcn/ui themed per `DESIGN.md` (Sofia Sans), Vercel · Supabase cloud (`kleeno-dev`, `kleeno-prod`; Postgres, Auth, RLS; CLI via npx, no Docker) · Circle dev-controlled wallets SDK (`ARC-TESTNET`) · Solidity + Foundry · viem · OpenRouter (adapter, model + fallback from config, $5 cap) · Zod, decimal library, Vitest, Playwright (Chromium).

## How it is built
Phases, in order: P0 Setup · P1 Thin slice · P2 Foundation · P3 Data + AI · P4 Payments · P4b Payment Planner (can be cut) · P5 Demo + submission. Dates, cut order and minimum demo: `PRD.md` §12. Deliverables: `FILE-STRUCTURE.md`.
Per phase: write `Pn.md` (including that phase's `docs/security.md` rows) -> user approves -> backend (invoke the `ponytail` skill) -> `ponytail-review` -> UI (no Ponytail; follow `DESIGN.md`) -> "Done when" checks pass -> plain-language summary vs the docs -> user sees it in the browser -> second-agent review (P1, P2, P4 only) -> set security row status + update `PROGRESS.md` -> one commit on the phase branch -> PR, CI green, squash-merge to `main` (`docs/github.md`).
Stuck rule: after 3 failed fixes on one problem, stop, write the attempts, error and 2 options in `PROGRESS.md`, and ask the user.
Ponytail is for backend paths only, never UI (ESSENTIALS, Build).
Commands: `npm run dev|build|lint|test|test:invariants|test:db|test:e2e`; `forge build|test` in `contracts/`.

## Layout
```text
Kleeno/
├─ *.md                  this guide, PROGRESS, rules, architecture, PRD, file structure, DESIGN (visual system)
├─ docs/                 roadmap, security plan, page map, git/GitHub workflow, integrations/, decisions/ (ADRs), phases/ (Pn.md), demo script, traction, model eval
├─ contracts/            PayrollGuard: src, test (protected), script
├─ supabase/             migrations: schema, RLS, append-only audit, four-eyes
├─ scripts/              wallets, users, ABI, delete-company, seed, model eval
├─ src/core/             pure domain (money, engine, ai/inputs, payments/batches|signals|planner, ...)
├─ src/server/           adapters: db, auth, ai, circle, arc, rails, log
├─ src/app/              pages + api handlers
├─ src/components/       shared UI
└─ tests/                invariants + fixtures (protected), unit, db, e2e
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
