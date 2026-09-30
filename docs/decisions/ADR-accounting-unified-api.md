# ADR: Accounting unified API

Status: proposed, no vendor chosen. The first accounting feature needs no vendor at all.

## Options
Deterministic journal export only (file), direct adapters (QuickBooks Online, Xero first), a unified API (Rutter, Apideck, Codat; also Merge, Unified.to), or a mix.

## Comparison
"RV" = requires validation. Vendor-written sources, so biased.

| Criterion | Rutter | Apideck | Codat |
|---|---|---|---|
| QuickBooks Online / Desktop | RV | claims both | RV |
| Xero | RV | claims | RV |
| NetSuite | RV | claims | RV |
| Sage (Intacct) | RV | claims | RV |
| Journal entry write | RV | claims journal writes on the major ledgers | RV |
| Bank feeds | RV | RV | a core product (RV) |
| Read/write overall | RV | claims full CRUD | RV |
| Webhooks | RV | RV | RV |
| Raw / provider-specific access | RV | RV | RV |
| Data freshness / storage | RV | routes requests, no cache (claim) | sync-and-cache (claim) |
| Focus | commerce + accounting fintech | general SaaS integrations | lenders and banks |
| Pricing, reliability, lock-in | RV | RV | RV |

Sources: [Apideck: Rutter alternatives](https://www.apideck.com/blog/rutter-alternatives), [Apideck: Codat alternatives](https://apideck.com/blog/codat-alternatives), [Unified.to accounting comparison](https://unified.to/blog/best_unified_api_for_accounting_integrations_in_2026).

## Considerations for Kleeno
- A payroll journal is a small, balanced set of lines once per run. Volume is tiny; correctness, mapping and idempotency matter far more than coverage.
- Posting needs an explicit, approved account mapping per company (`docs/integrations/accounting.md`). A unified API does not remove that work.
- Lock-in risk is low at first: the `AccountingDestination` port isolates the vendor.

## Decision (provisional)
1. Next: deterministic journal **preview export** (no external write, no vendor).
2. Later: direct QuickBooks Online and Xero adapters when a pilot asks, since they cover most US small businesses.
3. Re-evaluate a unified API when customers need NetSuite, Sage Intacct or Business Central, or more than two ledgers. Do not add a paid dependency before that.
