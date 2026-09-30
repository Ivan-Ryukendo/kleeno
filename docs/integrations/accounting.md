# Accounting Destinations

Port: `AccountingDestination` (README §4). Providers: `provider-matrix.md`. Unified API decision: `docs/decisions/ADR-accounting-unified-api.md`.

## Journal from approved payroll
- Built deterministically from an **approved** calculation (and, for the cash side, the SETTLED obligations). Never from a draft, never by an LLM.
- Each journal line references the calculation line IDs and the `calculation_hash`, so every debit and credit traces back to approved payroll.
- Totals: debits = credits exactly, in micro-USDC; an unbalanced journal is rejected before preview.
- Journal date = pay date; an external reference = journal hash, so posting twice has one effect (rule 49).

## Account mapping
- Explicit company configuration, versioned and approved like payroll config: component (gross wages by pay type, each deduction, net pay payable, USDC clearing) -> account ID in the company's chart of accounts.
- Never invented. A missing or inactive account blocks preview and posting with a clear exception.
- AI may later **suggest** a mapping as a proposal (validated against the chart of accounts, human-approved), exactly like policy rules. It never picks accounts, debits, credits, tax amounts or totals on its own.

## Stages
1. **Journal preview export** (Next): a balanced CSV/JSON journal download from an approved run; no external write, no vendor. Capability `JOURNAL_PREVIEW`.
2. **Read chart of accounts** (Later): `CHART_OF_ACCOUNTS_READ` to validate the mapping.
3. **Post journal** (Later): `JOURNAL_WRITE`, after a human confirms, audited, idempotent; `JOURNAL_READ` to verify.

## Tests (with stage 1)
Journal balanced; debit total = credit total; every mapping explicit; missing mapping blocks; every line traces to an approved calculation line; re-export gives the same hash.
