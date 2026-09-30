# ADR: HRIS / payroll unified API

Status: proposed, no vendor chosen. Revisit when three or more pilots use different HR/payroll systems.

## Options
Direct connectors per provider, a unified API (Finch, Merge, Unified.to), or both. The architecture supports both: a unified provider is one more connector whose descriptor lists the capabilities it actually delivers, and whose provenance records both the unified provider and the underlying system.

## Comparison
"RV" = requires validation (sales call, sandbox or contract). Vendor claims are marked as claims; none of this is tested.

| Criterion | Finch | Merge | Unified.to |
|---|---|---|---|
| Provider coverage | claims 200+ HRIS/payroll systems | multi-category (HRIS, payroll, accounting, more); fewer HRIS than Finch by Finch's claim | claims ~247 HR & directory integrations |
| Payroll depth (pay statements, deductions) | strongest by claim; deduction write-back | RV | RV |
| Time / leave | RV | RV | claims time-off |
| Webhooks | RV | RV | RV |
| Auth for end customer | hosted connect flow (RV) | hosted link (RV) | hosted auth (RV) |
| Sandbox | RV | RV | RV |
| Data freshness | scheduled sync | scheduled sync | real-time pass-through |
| Data storage | stores employment, compensation, tax and bank data until a connection is deactivated (per comparison sources) | stores synced data until deleted | claims no customer data at rest |
| Provider-native fields | RV | passthrough requests (RV) | RV |
| Provenance (source object ID, updated at) | RV | RV | RV |
| Pricing / contract | RV | RV | RV |
| Data residency | RV | RV | RV |

Sources (vendor-written, so biased): [Finch comparison](https://tryfinch.com/blog/best-unified-apis-hris-payroll), [Unified.to comparison](https://unified.to/blog/best_unified_api_for_hris_integrations_in_2026), [Knit: Merge vs Finch](https://getknit.dev/blog/merge-vs-finch).

## Considerations for Kleeno
- Confidentiality (rule 50): a sync-and-store vendor holds a copy of our customers' payroll and bank data. That becomes a sub-processor question for every pilot. Pass-through reduces this but adds latency and makes every sync depend on the vendor being up.
- Kleeno never needs bank details or tax IDs; any vendor must let us request only the fields we map.
- Snapshots make pass-through safe for reproducibility: once evidence is imported and snapshotted, vendor data can change without affecting approved runs.

## Decision (provisional)
- Hackathon: none.
- First pilots: a direct connector for the one system the first pilot uses (likely Gusto, Rippling or Deel for US contractors), read-only, shadow-run use case.
- Re-evaluate a unified API at three or more distinct systems, scoring the table above after sandbox tests. Prefer one that requests only mapped fields and does not store bank or tax data.
