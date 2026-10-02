# Roadmap

Out-of-scope ideas land here only after the user approves them.

## Now — Hackathon MVP (by Oct 10, 2026)
Scope in `PRD.md` §5. Arc testnet USDC via `ArcUsdcRail`; SIMULATION + LIVE_TESTNET; pay types SALARIED, HOURLY, RETAINER; Payment Planner; standing authorization. First market (tentative): US firms paying remote contractors.
Added by the user on 2026-10-02: company system and workspaces (P3b); live-payments activation, Gateway top-up and Kleeno Verify via x402 (P4); policy documents, rule scopes and categories, Excel import, bonuses, commissions, reimbursements, fixed deductions, part-period pay (P4c); dashboard and motion (P4d).

## Next — Pilot hardening (weeks after the event)
- Lead list, after the waitlist (W): researched prospects table, interaction log, structured interview notes, funnel analytics beyond the W metrics, budget-by-role breakdown, launch/confirmation emails with unsubscribe links (needs an email provider), Cloudflare Turnstile if spam gets through
- Table views for every record list (Excel or Notion style: columns, filters, sort, group, saved views, AI-proposed view definitions); first version in P3 with match status, bulk resolve, side panel, totals and export, spec in `docs/pages.md` §5. Advanced next: inline edits as reviewed change requests, conditional highlighting, pivot and chart views, team-shared views, scheduled exports, keyboard navigation
- Close and reporting (gap review of Tabulera and Woodrow, 2026-10-02): period-end view (approved but unpaid, held, in transit, mismatched); run sign-off package (totals, exceptions + resolutions, approvals, tx hashes + receipt matches, journal lines); open items carried across runs until resolved; year-to-date totals and a year-end per-contractor summary; correction and off-cycle runs that reference the run they fix. Period-end view and sign-off package may move into P4/P5 if time allows (user decides)
- Worker profiles, leave ledger and long-term leave, worker self-service with HR-approved change requests, photo/document upload, leave reminders: proposed in `docs/decisions/ADR-worker-profiles.md` (an HR-only page and in-app reminders may fit the hackathon if time allows after P3)
- Pilot with first users (US firms paying remote contractors); real, consented data in `docs/traction.md`
- FX at import (non-USD sheets), with an approved rate
- Market presets: starting configs per country and worker type (e.g. US contractors)
- Allowances, holiday rules, leave balances; pay frequency per worker; year-to-date totals and the year-end 1099 contractor summary; correction and off-cycle runs (some overlap with "Close and reporting")
- Custom roles (full RBAC); open sign-up with spam protection; SSO
- Company legal details (legal name, address, tax ID encrypted, Owner-only) and logo
- Invite and notification emails beyond invites (Resend), once the domain mail is fixed
- Worker tables inside PDF or Word files (needs reliable table extraction in the browser)
- AI embeddings for policy similarity (pgvector, behind our AI adapter) when long handbooks need it
- x402 beyond Kleeno Verify: Kleeno's agents buying services with a price preview and hard caps; per-run or per-worker pricing paid through x402
- Payslip PDFs, reporting, variance analytics
- Wider model evaluation across open models
- First connector for the first pilot's HR/payroll system: read-only shadow run (actual paid + timesheets), with the connection model (`docs/integrations/`)
- Read-only Kleeno MCP server (`docs/integrations/mcp.md`)
- Accounting journal preview export (`docs/integrations/accounting.md`)

## Later — Product
- Global rollout market by market, each configured through the AI config
- Second `PaymentRail`: fiat/mobile-money payout via a licensed partner
- Jurisdiction rule packs (tax, pension) as approved, versioned configuration
- Other Circle services: CCTP, Paymaster, Gateway beyond payroll top-up
- Owner key held by the payment approver, not the server
- Security assurance (deferred list in `docs/security.md` §4): KMS/HSM, external immutable log sink, penetration test, SOC 2 / ISO 27001 mapping, incident-response runbook, backup restore drill, MFA for approvers, session policy
- Audit anchor: hash of approved artifacts on-chain (optional)
- More integrations: accounting write (QuickBooks Online, Xero first), unified APIs (`docs/decisions/`), SSO (Google Workspace, Entra ID, Okta), Slack/Teams notifications, expense and document sources
- Mainnet readiness: security review, key management, compliance review

## Not planned
On-chain payroll data, tokenomics, unrestricted autonomous agents.

## Principles
Direction (user, 2026-10-02): start simple for the hackathon, then grow into the most advanced payroll app that is still easy to use. Each new feature keeps the rules below.
Payroll core stays rail-agnostic and vendor-agnostic; external systems are evidence, never authority; AI proposes, deterministic code calculates, humans approve; fail closed.
