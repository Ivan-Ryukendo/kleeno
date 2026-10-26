<p align="center">
  <a href="https://kleeno.orclide.com"><img src="docs/media/banner.svg" alt="Kleeno: payroll that can't pay the wrong person" width="100%"></a>
</p>

<p align="center">
  <strong>AI-assisted payroll reconciliation and guarded USDC settlement for teams that pay contractors.</strong>
</p>

<p align="center">
  <a href="https://github.com/Ivan-Ryukendo/kleeno/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ivan-Ryukendo/kleeno/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white" alt="CI status"></a>
  <a href="https://github.com/Ivan-Ryukendo/kleeno/stargazers"><img src="https://img.shields.io/github/stars/Ivan-Ryukendo/kleeno?style=flat&logo=github&label=Stars" alt="GitHub stars"></a>
  <a href="https://github.com/Ivan-Ryukendo/kleeno/commits/main"><img src="https://img.shields.io/github/last-commit/Ivan-Ryukendo/kleeno?label=Last%20commit" alt="Last commit"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-141413" alt="License: AGPL-3.0-only"></a>
  <a href="https://kleeno.orclide.com"><img src="https://img.shields.io/badge/Website-kleeno.orclide.com-CF4500" alt="Website"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-141413?logo=nextdotjs&logoColor=white" alt="Next.js 16">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white" alt="Node.js 22">
  <img src="https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3ECF8E?logo=supabase&logoColor=white" alt="Supabase">
  <img src="https://img.shields.io/badge/Solidity-Foundry-363636?logo=solidity&logoColor=white" alt="Solidity with Foundry">
  <img src="https://img.shields.io/badge/Circle-Wallets-1F2937" alt="Circle developer-controlled wallets">
  <img src="https://img.shields.io/badge/USDC-Arc%20testnet-2775CA" alt="USDC on Arc testnet">
  <img src="https://img.shields.io/badge/Tameion%20Agents%20Hackathon-2026-F37338" alt="Tameion Agents Hackathon 2026">
</p>

<p align="center">
  <a href="https://kleeno.orclide.com">Website</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#safety-model">Safety model</a> ·
  <a href="#running-locally">Run locally</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="docs/roadmap.md">Roadmap</a>
</p>

---

AI reads your pay policy and messy timesheets. Plain code does the maths. People approve. A smart contract pays exactly what was approved, once, in USDC on Arc testnet, and every payment is checked against the on-chain receipt.

> [!IMPORTANT]
> **Arc testnet only: no real funds move.** Kleeno is in active development for the Tameion Agents Hackathon (Canteen × Arc), 2026. Worker wallets are custodial (company-managed). Net amounts and recipient addresses are public on-chain by nature; names and payroll detail never go on-chain.

<!-- Demo section hidden until the demo is ready. To restore: remove these comment markers and re-add the Demo link to the nav above.
## Demo

Demo video and screenshots: docs/media/demo-video.svg (replace with a thumbnail and link the Loom/YouTube/Vimeo video), docs/media/screenshot-*.svg.

| | |
|---|---|
| <img src="docs/media/screenshot-dashboard.svg" alt="Dashboard (screenshot coming soon)"> | <img src="docs/media/screenshot-configuration.svg" alt="Policy to rules (screenshot coming soon)"> |
| **Dashboard:** where the period stands and what's next | **Policy to rules:** AI proposes rules with cited clauses; HR approves |
| <img src="docs/media/screenshot-exceptions.svg" alt="Exceptions (screenshot coming soon)"> | <img src="docs/media/screenshot-payroll-review.svg" alt="Payroll review (screenshot coming soon)"> |
| **Exceptions:** flagged with evidence; a human decides | **Payroll review:** every amount traced to its source rows |
| <img src="docs/media/screenshot-settlement.svg" alt="Settlement (screenshot coming soon)"> | |
| **Payment plan and settlement:** signed plan, guarded payment, Arc receipt match | |

Screenshots use synthetic demo data only.
-->

## Why

Small businesses pay their teams from spreadsheets. Missed or unapproved hours, duplicate timesheets, wrongly deducted leave and payments to a changed wallet are found late or never. "Autonomous" AI payroll is unsafe, because models guess numbers. Kleeno keeps the AI useful and out of the money path.

## How it works

```text
Policy (plain words) -> AI proposes rules -> validation -> HR approves the config
CSV import (names stripped in the browser) -> checks + AI classification -> exceptions -> HR resolves
-> deterministic engine with a full calculation trace -> HR approves payroll
-> payment plan (AI orders, holds and flags) -> a different person signs it
-> PayrollGuard contract pays only the signed obligations -> Arc receipt reconciliation -> audit trail
```

- **SIMULATION** (default): runs the full pipeline on last period's data and reports variances against what was actually paid. It can never pay.
- **LIVE_TESTNET**: continues to approval and guarded USDC payment on Arc testnet.
- Pay types: salaried, hourly and retainer.

## Safety model

| Principle | How it is enforced |
|---|---|
| AI proposes, never decides | AI output is schema-bound data with no amount, recipient or state fields; every suggestion is validated and needs a human |
| Code calculates | A pure, deterministic engine; the same inputs give the same result and hash; every amount has a trace |
| Four eyes | Payroll approver and payment approver must be different people, enforced in the database |
| The contract limits the agent | `PayrollGuard` commits the exact approved set per batch; the payment agent can only call `pay(obligationKey)`, once per key |
| Verified, not trusted | A payment counts as settled only when the Arc receipt matches obligation, recipient and amount |
| Fail closed | Any mismatch blocks payment and raises an exception; a kill switch stops every payment path |
| Private by default | Names never reach the server; pay and policy fields are encrypted per company; read-only public DB API; MFA for real companies |

Full security plan: [`docs/security.md`](docs/security.md).

## Tech stack

Next.js (App Router, TypeScript strict) · Tailwind + shadcn/ui · Supabase (Postgres, Auth, RLS) · Circle developer-controlled wallets · Solidity + Foundry · viem · OpenRouter · Zod · Vitest · Vercel.

## Repository layout

```text
src/core/        pure domain: money, engine, reconciliation, payments (no framework imports)
src/server/      adapters: database, auth, encryption, AI, Circle, Arc
src/app/         pages and thin API handlers
contracts/       PayrollGuard (Solidity) + Foundry tests
supabase/        migrations: schema, RLS, append-only audit, four-eyes triggers
tests/           invariants, fixtures, unit, database tests
docs/            security plan, pages, integrations, decisions, phase plans
```

## Running locally

Requires Node.js 22, a Supabase project, and (for payments) a Circle testnet account. Foundry is needed only for the contract.

```bash
npm install
cp .env.example .env      # fill in; never commit .env
npm run dev
```

Checks:

```bash
npm run lint && npm run typecheck && npm test
npm run test:db                    # needs a local Supabase stack
cd contracts && forge build && forge test
```

## Documentation

| Document | Contents |
|---|---|
| [`PRD.md`](PRD.md) | Scope, demo scenario, acceptance criteria |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Technical design |
| [`ARCHITECTURE-ESSENTIALS.md`](ARCHITECTURE-ESSENTIALS.md) | Rules every change follows |
| [`docs/security.md`](docs/security.md) | Controls, tests and status |
| [`docs/roadmap.md`](docs/roadmap.md) | What comes after the hackathon |
| [`PROGRESS.md`](PROGRESS.md) | Where the build stands |

## Project status

| Phase | Status |
|---|---|
| P0 Setup · P1 Thin slice (guarded payment on Arc) · P2 Foundation (engine, auth, encryption, workers) | Done |
| Waitlist and landing page ([kleeno.orclide.com](https://kleeno.orclide.com)) | Live |
| P3 Data + AI (policy to rules, CSV import, reconciliation, table views) | In progress |
| P4 Payments · P4b Payment Planner · P5 Demo + submission | Planned |

## Contact

Questions, feedback or permission requests: open an issue or contact [@Ivan-Ryukendo](https://github.com/Ivan-Ryukendo) on GitHub. Please do not report security issues in public issues; contact the maintainer directly.

## License

Copyright (c) 2026 Mirza Gamal Abdel Nasser.

Kleeno is open-source software licensed under the **GNU Affero General Public License v3.0 only** (SPDX: `AGPL-3.0-only`). See [LICENSE](LICENSE) for the complete terms.

Commercial use, paid hosting, modification and redistribution are permitted under the license. If you modify the program and let users interact with it over a network, you must prominently offer those users access to the corresponding source of your version under AGPL-3.0. Distribution also carries source and notice obligations.

Third-party components, including dependencies, bundled fonts and `contracts/lib/forge-std`, retain their own licenses and notices. The software license does not grant trademark rights to Kleeno's name or logo. For separate commercial licensing inquiries, contact [@Ivan-Ryukendo](https://github.com/Ivan-Ryukendo).

This remains a testnet prototype, not intended to move real funds or run real payroll, and provides no payroll, tax, legal or financial advice.
