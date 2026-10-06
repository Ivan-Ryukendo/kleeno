# P4d — Dashboard and workforce history

Status: **in progress**; owner-approved 2026-10-05. Local implementation is underway; phase acceptance remains open.

Files/ownership/tests: [system completion plan](../plans/2026-10-05-system-completion.md), task 5. Audit/seed/e2e remain P5 even when the same lane prepares them. Read project memory/ESSENTIALS, DESIGN §11, docs/pages §6 and UI/UX Pro Max.

## Scope

Extend existing setup checklist/live status/role-aware to-dos/run list with selected-period stepper, actual metrics, actionable block reasons, activity and run/worker history. Reuse shell/read repositories/table views; no fictional counts or speculative controls.

## Approved resource table workflow (2026-10-05)

Owner approved policy-generated typed resource columns, HR custom columns, per-cell source/rule/workflow disclosure, drag ordering, formula previews and cell comments. The local implementation now includes typed resource definitions, reviewed inputs, personal persisted layouts and encrypted shared cell threads; database acceptance remains pending. Full contract and mission details are in the [system completion plan](../plans/2026-10-05-system-completion.md#policy-driven-resource-columns-owner-request-2026-10-05).

Approved behavior: company-configured leave with no preset entitlement; actual/target percentage and weighted KPI performance; computed results read-only; reviewed, reasoned and audited typed input edits; personal saved layouts; shared cell-level threads for authorized company members. Missing policy/evidence remains Data required; no preset balance or inferred metric. Require versioned evidence, stable comment targets, safe storage, order-consistent export and keyboard/touch/reduced-motion acceptance. These presentation and resource workflows grant no approval or payment authority.

## Done when

Oct 6 local acceptance: the standalone synthetic `tests/unit/table.browser.ts` passes using the real Kleeno stylesheet, checking hidden/hover/focus formula disclosure, direct and context-menu Comments focus, drag reordering and layout-save requests. Mock endpoints do not prove database authorization, stored layouts/comments or a deployed owner review. Full SIMULATION browser workflow awaits an isolated migrated database.

- Policy -> Import -> Exceptions -> Calculation -> Approval -> Settlement accurately reflects actual state machines; SIMULATION finishes at validated calculation/variance and cannot offer payments.
- Period/company/mode/live status and blocked-stage next action are clear. Role-aware UI links never replace server permission checks.
- Bounded tenant-scoped queries provide actual counts/totals/activity/history. Empty/loading/error states work; cross-company/unauthorized requests fail in DB/API tests.
- History/audit references are safe; no raw prompts/names/chain-of-thought. Local name-key display stays browser-only. Exports retain authorized columns/escaping/required audit.
- DESIGN tokens/shadcn, focus/labels/keyboard/AA contrast/mobile/reduced motion pass observed browser checks. No financial/approval motion; success green awaits explicit owner approval.
- First write failing read-model acceptance, then implement; run targeted DB plus lint/typecheck/unit/build/browser checks; independent spec review precedes quality review. Post-build Kimi review supplements these tests.

Retain applicable authoritative controls: S25 safe CSV export, S33 linked audit/request evidence, S36 generic errors/headers/rate limits, S38 SIMULATION/kill switch, S41–S42 confidential encryption/local names, S61 tenant/read authorization and immutable hashes/approvals/four-eyes on linked flows. Copy exact current security requirements into task handoffs; record actual checks at closure, never infer backend safety from appearance.
