# ADR: Integration abstraction

Status: accepted (user, 2026-09-30). Scope decision: foundation only in the hackathon.

## Context
Kleeno must later connect to HRIS, payroll, time, accounting, expense, document, notification and identity systems, and to external AI agents via MCP, without redesigning the payroll domain or weakening its trust model.

## Decision
1. External systems are evidence sources or destinations, never authorities (ESSENTIALS rule 51).
2. Code against **capabilities**, not vendors. Providers are typed descriptors in a registry; one normalized `integration_connections` model later, never one table per vendor (rule 52).
3. Every imported record carries **provenance**, and run snapshots reference evidence IDs + source hashes (rule 53).
4. A connector produces the **same normalized evidence** as the CSV import and enters the same validation, reconciliation and snapshot path. The CSV upload is the first registered source (`csv_upload`).
5. Vendor code lives only in `src/server/integrations/<provider>/`; `src/core` never names a vendor.
6. Integration credentials reuse existing mechanisms: platform OAuth app secrets in env; per-company tokens encrypted with the company data key (S41). No second secret store (rule 54).
7. Webhooks are hints: verify, dedupe, re-fetch (same as Circle).
8. Kleeno's own AI agents get no connector or MCP tool access; external data reaches them only through `src/core/ai/inputs/`.

## Built now vs later
P3: capability/category types, provider descriptor + `csv_upload`, `requireCapability`, provenance columns and schema, snapshot evidence references, tests S46–S48. Everything else later (`docs/integrations/README.md` §5).

## Consequences
- About half a day of P3 work; no new dependency; no new page.
- Adding a provider later = descriptor + connector + mapping + tests, no change to `src/core` domain logic.
- Open: names arriving from server-side HRIS APIs vs rule 35 (README §3.10). Must be decided before the first HRIS connector.

## Rejected
- Vendor-specific tables and code paths in core (lock-in, no reuse).
- Building connectors or MCP during the hackathon (deadline risk, no pilot demand yet).
- Letting Kleeno's LLM agents call external MCP servers directly (breaks the typed AI input boundary, rule 5).
