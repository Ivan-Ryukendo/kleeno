# Roadmap

Out-of-scope ideas land here only after the user approves them.

## Now — Hackathon MVP (by Oct 10, 2026)
Scope in `PRD.md` §5. Arc testnet USDC via `ArcUsdcRail`; SIMULATION + LIVE_TESTNET; pay types SALARIED, HOURLY, RETAINER; Payment Planner; standing authorization. First market (tentative): US firms paying remote contractors.

## Next — Pilot hardening (weeks after the event)
- Pilot with first users (US firms paying remote contractors); real, consented data in `docs/traction.md`
- FX at import (non-USD sheets), with an approved rate
- Market presets: starting configs per country and worker type (e.g. US contractors)
- Bonuses, allowances, holiday rules, leave balances, mid-period join/termination
- Full RBAC and multi-company features
- Payslip PDFs, reporting, variance analytics
- Wider model evaluation across open models
- First connector for the first pilot's HR/payroll system: read-only shadow run (actual paid + timesheets), with the connection model (`docs/integrations/`)
- Read-only Kleeno MCP server (`docs/integrations/mcp.md`)
- Accounting journal preview export (`docs/integrations/accounting.md`)

## Later — Product
- Global rollout market by market, each configured through the AI config
- Second `PaymentRail`: fiat/mobile-money payout via a licensed partner
- Jurisdiction rule packs (tax, pension) as approved, versioned configuration
- Other Circle services: Gateway, CCTP, Paymaster
- Owner key held by the payment approver, not the server
- Security assurance (deferred list in `docs/security.md` §4): KMS/HSM, external immutable log sink, penetration test, SOC 2 / ISO 27001 mapping, incident-response runbook, backup restore drill, MFA for approvers, session policy
- Audit anchor: hash of approved artifacts on-chain (optional)
- More integrations: accounting write (QuickBooks Online, Xero first), unified APIs (`docs/decisions/`), SSO (Google Workspace, Entra ID, Okta), Slack/Teams notifications, expense and document sources
- Mainnet readiness: security review, key management, compliance review

## Not planned
On-chain payroll data, tokenomics, unrestricted autonomous agents.

## Principles
Payroll core stays rail-agnostic and vendor-agnostic; external systems are evidence, never authority; AI proposes, deterministic code calculates, humans approve; fail closed.
