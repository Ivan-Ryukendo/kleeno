# Job/outbox decision

R6.5, 2026-10-11; source baseline integration `de6045a`. The owner delegated this decision. This memo adds no runtime behavior or permission to operate providers.

## Decision

**No new job runner or transactional outbox for the current interactive hackathon scope.** Keep explicit request-driven execution and existing entity-based recovery. Do not promise automatic completion after a browser closes, a provider notification is missed or a server process stops. A durable runner becomes necessary before offering unattended completion; an outbox is necessary when a business commit must reliably dispatch subsequent work. Revisit at that product requirement, rather than adding a generic queue now.

The [command inventory](command-inventory.md) shows why a universal retry queue would be unsafe: some routes have reviewed command keys/revisions, while worker compensation, adjustments, configuration drafts and batch planning lack general replay identity. Replaying a POST can append versions, replace evidence or discard a proposal. A queue does not repair these contracts. The [state store](../src/server/db/store.ts) already commits state CAS and its audit together; adding an outbox to those transitions would not itself fix field-level concurrent edits or external uncertainty.

## Current durability and concrete limits

| Flow | Persisted recovery evidence | Limit accepted for this scope |
|---|---|---|
| Payments | [Agent](../src/core/payments/agent.ts) saves an attempt before submission, preserves obligation/provider keys, re-queries Arc/Circle and gates same-key continuation. [Execution](../src/server/payments/execute.ts) stops after an approximately 40-second budget and provides explicit recovery for old PAYING obligations and OPEN-batch roll-up. | Further AUTHORIZED obligations require another execute request; PAYING recovery requires a caller or usable notification. No scheduled tenant scan or guaranteed wake-up is implemented. UNKNOWN is not a retryable failure. |
| Circle notifications | [Signed route](../src/app/api/circle/webhook/route.ts) delegates to [notification handling](../src/server/payments/execute.ts), which re-queries authoritative evidence and records notification identity after recovery/roll-up. | Unknown transaction IDs are ignored; concurrent deliveries can both reconcile. A missed notification or failure to receive another request can leave persisted work pending. Deduplication is not a durable inbox with a leased worker. |
| Reconciliation and calculation | [Reconciliation retry](../src/server/db/reconciliation.ts) resumes RECONCILING and uses exception dedupe/CAS; [calculation](../src/server/db/calculate.ts) reuses verified captured results and checks committed input revisions. | Recovery is explicit. AI/read work can repeat before the state CAS. A crash between a successful transition and separate follow-up audit can leave the latter missing; no dispatcher repairs every gap. |
| Stripe TEST billing | [Webhook receipts/reconciliation](../src/server/db/billing-provider.ts) retain signed hints and use a lease/receipt sequence; [collection](../src/server/db/billing-collection.ts) persists command stages, provider keys and uncertain outcomes. | Signed hints await explicit Owner reconciliation. Persisted commands/leases are not an automatic worker: IN_FLIGHT/UNKNOWN requires exact-object reconciliation, not a new command key. |
| Gateway top-up | [Gateway](../src/server/circle/gateway.ts) stores the transfer and per-step transaction IDs, using transfer-derived Circle keys. | Progress requires explicit continuation. A provider timeout does not authorize a new transfer or payroll payment. |

These are inspected implementation properties, not a new crash-test, uptime or live-provider acceptance claim. Business writes and separate audits are not universally atomic; [R6.1](command-inventory.md) records those gaps. Current financial state remains authoritative even when recovery is delayed. Review sign-off/export records remain separate from payment approval.

## When the decision changes

Require a bounded design and ledger implementation task when Kleeno promises completion without another user request, scheduled recovery/alerts, connector sync, or reliable downstream delivery. First name the operation and its deadline/recovery objective. A polling job can discover already-persisted PAYING/OPEN or pending receipt states; use an outbox only for a dispatch obligation that must be committed atomically with the business write. Neither needs a second authoritative workflow or external queue by default: evaluate the existing Postgres store first.

The minimum implementation must bind immutable tenant/entity/command references, atomically persist required dispatch intent, deduplicate work, claim with expiring leases and fencing, bound retries/backoff, retain observable attempt/outcome evidence, and stop uncertain outcomes for reconciliation. Test crash-after-commit, lease expiry, duplicate/concurrent delivery, tenant mismatch, revoked authority and permanent failure on a disposable stack before enabling it.

Never persist or replay passwords, TOTP codes, human approval requests or signing credentials. A worker may only continue an already-authorized operation through existing services and current checks. Payment gate, kill switch, SIMULATION boundary, plan/hash binding, four-eyes and independent Arc settlement verification remain mandatory on each continuation. See [ESSENTIALS](../ARCHITECTURE-ESSENTIALS.md) and [security S26-S30/S66](security.md). No automatic UNKNOWN resubmission with a fresh key, provider failover, new authority, funds movement or provider activation follows from this memo.

## Outcome

R6.5 resolves the present yes/no decision: defer job/outbox implementation and explicitly retain operator-driven recovery limits. It does not close R6.2 concurrent-edit work, payment drills/live evidence, commercial recovery objectives or a future unattended-delivery gate. No new runtime task is invented by this memo.
