# Kleeno — Integrations

How Kleeno connects to other systems (HR, payroll, time, accounting, expenses, documents, notifications, identity, AI agents via MCP) without changing the payroll domain. Rules: `ARCHITECTURE-ESSENTIALS.md` rules 51–55. Security rows: `docs/security.md` S46–S50. Decisions: `docs/decisions/`.

Principle: **build the sockets now, add appliances when a real customer needs them.** During the hackathon we build only the foundation (P3). Every connector, the MCP server and accounting export come later (`docs/roadmap.md`).

## 1. Boundary
External systems are **evidence sources** (they tell us facts) or **destinations** (we send them approved results). They are never authorities.

| External systems and MCP clients may | They may never |
|---|---|
| supply workers, compensation, schedules, timesheets, leave, amounts actually paid, policy documents, as evidence | invent or change payroll rules, calculate final pay, change approved amounts |
| receive approved, deterministic results (journal, notification, read-only MCP answers) | skip mapping, validation or reconciliation; resolve exceptions |
| authenticate a user (identity provider) | approve anything; grant Kleeno roles; bypass four-eyes |
| send webhooks as hints to re-fetch | set any state from a payload; move a run between states |
| | create obligations, change recipients, authorize payments, open guard runs, call `PayrollGuard.pay` or the gate |

"Approved in the source system" never means approved in Kleeno. An approved timesheet or reimbursement in Rippling or Ramp is still only evidence; Kleeno's reconciliation and human approvals decide.

## 2. Flow
```text
External system ──(connector, src/server/integrations/<provider>, server only)──┐
CSV upload ──(browser anonymise, the first source: csv_upload)──────────────────┤
                                                                                v
              normalized evidence + provenance (src/core/integrations, src/core/ingest)
                  -> same validation, USD check, dedupe as CSV (§8 ARCHITECTURE)
                  -> reconciliation + exceptions -> immutable run snapshot
                  -> deterministic engine -> approvals -> (payments, unchanged)
Approved results ──> destinations (journal export, notifications, read-only MCP)
```
A connector is just another way to produce the same normalized evidence the CSV import produces. Nothing downstream knows or cares which source it was.

## 3. Building blocks

### 3.1 Categories
`HRIS`, `PAYROLL`, `TIME`, `ACCOUNTING`, `EXPENSE`, `DOCUMENT`, `NOTIFICATION`, `IDENTITY`, `PAYMENT`. A provider can be in several (Rippling: HRIS, PAYROLL, TIME).

### 3.2 Capabilities
Code asks for a capability, never for a vendor. A provider declares what it supports; asking for anything else fails closed with `CAPABILITY_NOT_SUPPORTED`.

| Group | Capabilities |
|---|---|
| Employment | `EMPLOYEE_READ`, `COMPENSATION_READ`, `EMPLOYMENT_STATUS_READ`, `SCHEDULE_READ`, `TIMESHEET_READ`, `TIME_OFF_READ`, `TIME_OFF_BALANCE_READ`, `PAYROLL_RUN_READ`, `PAYROLL_INPUT_READ`, `DEDUCTION_READ`, `BENEFIT_READ` |
| Expense | `EXPENSE_READ`, `REIMBURSEMENT_READ` |
| Accounting | `ACCOUNT_READ`, `CHART_OF_ACCOUNTS_READ`, `JOURNAL_PREVIEW`, `JOURNAL_WRITE`, `JOURNAL_READ` |
| Other | `DOCUMENT_READ`, `FILE_PICKER`, `NOTIFICATION_SEND`, `IDENTITY_AUTHENTICATE` |

Read and write are separate capabilities. No capability exists for approving, paying, changing recipients or moving states, so no provider can ever be granted one.

### 3.3 Provider descriptor (the registry)
One typed record per provider, in code, not one table per vendor: `providerId`, `categories`, `displayName`, `authMethod` (`NONE` | `OAUTH2` | `API_KEY`), `capabilities` (read/write), `webhooks` (yes/no + verification method), `syncStrategy` (`MANUAL` | `CURSOR` | `UPDATED_SINCE` | `FULL`), `requiredScopes` (least privilege per capability), `dataSensitivity` (`LOW` | `CONFIDENTIAL` | `RESTRICTED`), `version`.
The hackathon registry holds one provider: `csv_upload` (auth `NONE`, sync `MANUAL`, capabilities `EMPLOYEE_READ`, `COMPENSATION_READ`, `SCHEDULE_READ`, `TIMESHEET_READ`, `TIME_OFF_READ`, `PAYROLL_RUN_READ` for amounts actually paid).

### 3.4 Connections (later)
Per company, one row per connected provider in `integration_connections`: `company_id`, `provider_id`, status, granted scopes, enabled, connected by, last sync, last success, sync cursor, error code, token expiry, and the OAuth tokens **encrypted with the company's data key** (S41). No new secret store. Kleeno's own OAuth app credentials per provider are platform secrets in env (`docs/security.md` §2). Company ownership comes from the session, never the request (rule 33).

Lifecycle (compare-and-set, audited):
```text
DISCONNECTED -> CONNECTING -> CONNECTED | ERROR
CONNECTED -> SYNCING -> CONNECTED | DEGRADED | REAUTH_REQUIRED | ERROR
DEGRADED -> SYNCING | REAUTH_REQUIRED | ERROR
REAUTH_REQUIRED | ERROR -> CONNECTING
any -> DISCONNECTED_BY_USER (revoke at the provider, delete tokens, keep provenance history) -> CONNECTING
```
Each sync is a row in `integration_sync_runs` (cursor from/to, counts, partial or complete, error), so a partial sync is visible and resumable.

### 3.5 Provenance (built in P3)
Every imported record carries: `source_provider`, `source_connection_id` (null for CSV), `source_object_type`, `source_object_id`, `source_version` (provider version or `updated_at`), `source_fetched_at`, `source_hash` (hash of the normalized record), `source_reference` (a safe pointer such as the import batch ID; never a URL with a token). Raw external payloads are not stored. Keeping them would need an explicit, user-approved retention policy.
For CSV: `source_provider = csv_upload`, object type = import type, object ID = the row's natural key, reference = import batch.
Run snapshots keep each evidence record's ID and `source_hash`, so "where did this payroll fact come from?" is answered from the snapshot alone.

### 3.6 Snapshots
External systems change; approved payroll does not. A later change in the source creates a new evidence version. It never edits a snapshot, calculation or approval (rules 15, 48). Same snapshot + same config version -> same `calculation_hash`.

### 3.7 Sync and idempotency (later, per connector)
Cursor or updated-since where the provider offers it, else a bounded full sync with hash comparison. Dedupe key: (company, connection, object type, object ID, source version), backed by a unique index (rule 49). Same version twice = one record; a new version = a new evidence version, never an in-place edit. Retries use backoff and honour provider rate limits. A timeout never duplicates evidence. Failures set `DEGRADED` or `ERROR` and audit the event; last successful sync is shown.

### 3.8 Webhooks (later)
```text
verify signature -> dedupe (webhook_notifications, unique per provider + event ID) -> store receipt
  -> re-fetch the record from the provider API -> normalize -> validate -> audit
```
The payload is only a hint, exactly as for Circle (S27). The handler imports no state setter, gate or rail.

### 3.9 AI boundary
External data reaches an LLM only as normalized, schema-checked evidence through `src/core/ai/inputs/` (rule 5): IDs, numbers, enums, and bounded policy clauses. Never tokens, keys, wallet addresses, names, raw external JSON or whole documents. Kleeno's own AI agents are **not** given MCP tools or connector access.

### 3.10 Names from HR systems (open decision)
Rule 35 says names never reach the server. The CSV path keeps that promise because the browser strips names. A server-side HRIS connector would receive names from the provider's API. Before the first HRIS connector, the user must choose one of these: request only fields without names where the API allows it; strip names in memory in the connector and never store or log them (which relaxes rule 35); or run the fetch in the browser. Until then, rule 35 stands unchanged.

## 4. Ports (added with the first connector, never before)
| Port | Methods -> capability |
|---|---|
| `EmploymentEvidenceSource` | `listWorkers`, `getWorker` -> `EMPLOYEE_READ`; `getCompensation` -> `COMPENSATION_READ`; `getEmploymentStatus`; `getSchedules`; `getTimeOff`; `getTimeOffBalances`; `getTimesheets`; `getPayrollInputs`; `getPayrollRuns` (actual paid, for variance) |
| `AccountingDestination` | `getChartOfAccounts`, `previewJournal`, `validateJournal`, `getJournal`, `postJournal` (write, later) |
| `DocumentSource` | `pickFile`, `getDocument` (bounded, selected by a human) |
| `Notifier` | `send(minimal message + link)` |
Each method returns normalized evidence with provenance, or `CAPABILITY_NOT_SUPPORTED`. Vendor code lives only in `src/server/integrations/<provider>/`; `src/core` never names a vendor.

## 5. What is built when
| Item | When |
|---|---|
| Capability + category types, provider descriptor, `csv_upload` descriptor, `requireCapability`, provenance schema + columns, snapshot evidence references, tests (S46–S48) | P3 |
| `webhook_notifications` keyed by provider + event ID (Circle is the first provider) | P4 |
| Connection table + lifecycle, sync runs, first connector, ports, Settings → Integrations page | Next (after the hackathon, driven by pilot demand) |
| Read-only Kleeno MCP (`mcp.md`) | Next |
| Journal preview export (`accounting.md`) | Next |
| Accounting write, unified APIs, SSO, notifications, expenses, documents | Later |

## 6. Adding a connector (checklist)
1. The user approves it for `docs/roadmap.md` (a real customer need).
2. Validate the provider's API, scopes, sandbox and webhooks against its current docs; update `provider-matrix.md`.
3. Add its descriptor with only the capabilities actually implemented and the smallest scopes.
4. Map provider objects to normalized evidence + provenance; drop every field Kleeno doesn't need.
5. Tests: capability limits, provenance, idempotent re-sync, webhook replay, cross-company denial, snapshot unchanged after source edit.
6. Add its secrets to `docs/security.md` §2, and its controls as new rows.

## 7. Files here
`provider-matrix.md` (all providers, capabilities, status) · `hris-payroll.md` · `accounting.md` · `expenses.md` · `documents.md` · `notifications.md` · `identity.md` · `mcp.md`.
