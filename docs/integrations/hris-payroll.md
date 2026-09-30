# HRIS, Payroll and Time Sources

Evidence sources for the five Kleeno import types. Port: `EmploymentEvidenceSource` (README §4). Providers: `provider-matrix.md`.

## Mapping to Kleeno evidence
| Kleeno import type (ARCHITECTURE §8) | Capabilities | Typical source objects |
|---|---|---|
| workers / compensation | `EMPLOYEE_READ`, `COMPENSATION_READ`, `EMPLOYMENT_STATUS_READ` | employee, employment, compensation |
| schedules | `SCHEDULE_READ` | schedule, shift |
| timesheets | `TIMESHEET_READ` | timesheet, punch, time entry |
| leave records | `TIME_OFF_READ`, `TIME_OFF_BALANCE_READ` | time-off request, balance |
| amounts actually paid (variance) | `PAYROLL_RUN_READ`, `PAYROLL_INPUT_READ`, `DEDUCTION_READ` | pay statement, payroll run |

Each record becomes normalized evidence with provenance (README §3.5) and then follows the CSV path: USD check (rule 7), validation, dedupe, reconciliation, snapshot.

## Rules
- The provider's approval state (approved timesheet, approved leave) is stored as evidence, never as a Kleeno approval. Kleeno's reconciliation and HR approver still decide.
- The provider's computed pay is **only** "amount actually paid" evidence for the SIMULATION variance report. The Kleeno engine never reads it as an input (ESSENTIALS rule 51).
- Compensation from a provider enters as evidence. It must pass the same validation and the recipient/compensation change review before a run uses it.
- Never import bank details, tax IDs, SSNs, addresses, dates of birth or wallet addresses. Recipients change only through Kleeno's confirmation flow.
- Worker identity: the connector maps the provider's worker ID to a Kleeno pseudonymous code (W001…). Names: open decision, README §3.10.
- Non-USD compensation or pay is rejected until FX exists (roadmap).
- Only the capabilities the company enabled are requested, with the smallest scopes.

## First use cases (when a pilot needs them)
1. **Shadow run from the payroll provider:** read last period's payroll run (actual paid) + timesheets from Gusto/Rippling/ADP, run Kleeno in SIMULATION, show variances. Read-only, no payment risk, direct traction value.
2. **Timesheet and leave sync:** replace the CSV upload for companies whose time lives in an HRIS.
