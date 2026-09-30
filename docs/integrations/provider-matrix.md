# Provider Matrix

Planning list, not a commitment. **Every capability below is "expected" and requires validation** against the provider's current API docs, scopes and sandbox before building (README §6). Checked 2026-09-30 only where a source is given. Priority = provisional build order within the category.

Capability shorthand: EMP = `EMPLOYEE_READ`, COMP = `COMPENSATION_READ`, STAT = `EMPLOYMENT_STATUS_READ`, SCHED = `SCHEDULE_READ`, TS = `TIMESHEET_READ`, TO = `TIME_OFF_READ` (+ balances), PR = `PAYROLL_RUN_READ`, PIN = `PAYROLL_INPUT_READ`, DED = `DEDUCTION_READ`, BEN = `BENEFIT_READ`.

## HRIS / payroll / time
| # | Provider | Categories | Expected capabilities | Auth | Status / notes |
|---|---|---|---|---|---|
| 1 | BambooHR | HRIS, TIME | EMP, COMP, STAT, TO | OAuth 2 | Official MCP server documented, with OAuth and BambooHR's own permissions ([docs](https://documentation.bamboohr.com/docs/mcp-server)). Reported as private beta in Jul 2026 ([source](https://hirevire.com/articles/bamboohr-mcp)): availability requires validation. Kleeno would call its REST API from a connector, not give its MCP to our AI (README §3.9). |
| 2 | Rippling | HRIS, PAYROLL, TIME | EMP, COMP, STAT, SCHED, TS, TO, PR | OAuth 2 (partner app) | REST API for workers and compensation. An official governed MCP interface is claimed but not confirmed; only third-party MCP servers were found. Requires validation. |
| 3 | Gusto | PAYROLL, HRIS | EMP, COMP, STAT, TO, PR, DED, BEN | OAuth 2 (partner) | Payroll runs = amounts actually paid -> SIMULATION variance (best first use). |
| 4 | ADP Workforce Now | HRIS, PAYROLL, TIME | EMP, COMP, SCHED, TS, TO, PIN | OAuth 2 + mutual TLS (API Central) | Partner or API Central subscription needed. Requires validation. |
| 5 | UKG Pro / Ready | HRIS, PAYROLL, TIME | EMP, SCHED, TS (punches, shifts), TO, PR | per product | Separate HCM, payroll and WFM surfaces; treat as separate descriptors. |
| 6 | Deel | HRIS, PAYROLL | EMP, COMP, STAT, TO, PR | OAuth 2 / token | Contractors worldwide: fits the first market. |
| 7 | Workday | HRIS, PAYROLL, TIME | EMP, COMP, STAT, TS, TO, PR | OAuth 2 / ISU | Enterprise; heavy setup. |
| – | Paylocity, Paycor, Paychex, HiBob, Personio, Justworks, TriNet, QuickBooks Payroll | mixed | EMP, COMP, TO, PR (varies) | varies | Unprioritised. Likely via a unified API (ADR-hris-unified-api) rather than direct. |

## Accounting
| # | Provider | Expected capabilities | Notes |
|---|---|---|---|
| 1 | QuickBooks Online | CHART_OF_ACCOUNTS_READ, JOURNAL_WRITE, JOURNAL_READ | Balanced `JournalEntry`. OAuth 2. |
| 2 | Xero | same | Manual journals; OAuth 2; rate limits per tenant. |
| 3 | NetSuite | same | Journal Entry via REST; Paycheck Journal record exists. Token-based auth or OAuth 2. |
| 4 | Sage Intacct | same | GL journal entries. |
| 5 | Microsoft Dynamics 365 Business Central | same | General journal lines; Entra ID auth. |
| – | QuickBooks Desktop, Zoho Books, FreshBooks, MYOB, Exact Online | varies | Unprioritised; unified API candidates. |

## Expenses (evidence only)
Ramp, Brex, Expensify, Navan, SAP Concur: `EXPENSE_READ`, `REIMBURSEMENT_READ`. See `expenses.md`.

## Documents
Google Drive, Microsoft OneDrive / SharePoint, Dropbox: `FILE_PICKER`, `DOCUMENT_READ`. See `documents.md`.

## Notifications
Slack, Microsoft Teams, email: `NOTIFICATION_SEND`. See `notifications.md`.

## Identity
Google Workspace, Microsoft Entra ID, Okta: `IDENTITY_AUTHENTICATE` via Supabase Auth SSO. See `identity.md`.

## Unified APIs (evaluated, not adopted)
| Provider | Area | Model (vendor claims, requires validation) |
|---|---|---|
| Finch | HRIS + payroll | 200+ HRIS/payroll systems; sync-and-store; deduction write-back ([source](https://tryfinch.com/blog/best-unified-apis-hris-payroll)) |
| Merge | HRIS, accounting, more | multi-category; stores synced data until deleted |
| Unified.to | HRIS, accounting, more | pass-through, no customer data at rest ([source](https://unified.to/blog/best_unified_api_for_hris_integrations_in_2026)) |
| Kombo | HRIS | Europe-focused; not researched |
| Apideck | accounting, HRIS | routes requests; journal entries on major ledgers ([source](https://www.apideck.com/blog/rutter-alternatives)) |
| Rutter | accounting + commerce | fintech focus |
| Codat | accounting, banking | sync-and-cache; lender focus |
Comparisons and decision: `docs/decisions/ADR-hris-unified-api.md`, `ADR-accounting-unified-api.md`.
