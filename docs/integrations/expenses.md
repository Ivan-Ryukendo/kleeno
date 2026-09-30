# Expense and Reimbursement Sources (Later)

Ramp, Brex, Expensify, Navan, SAP Concur. Capabilities `EXPENSE_READ`, `REIMBURSEMENT_READ`.

- An approved reimbursement in the expense tool is **evidence**, not a payroll input. It becomes payable only through a catalog rule (e.g. a reimbursement component, added to the rule catalog when needed), deterministic validation, reconciliation and Kleeno's human approvals.
- Imported: worker ref, amount (USD only), date, category code, approval state, provenance. Not imported: receipt images, merchant free text, card numbers.
- Receipts stay in the source system; Kleeno keeps `source_reference` only.
- Prerequisite: reimbursements in the pay types and rule catalog (roadmap Next: "bonuses, allowances").
