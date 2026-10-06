# P4c — Policy documents and pay extensions

Status: **in progress**; owner-approved 2026-10-05. Local implementation is underway; phase acceptance and external verification remain open.

Task ownership/files/tests: [system completion plan](../plans/2026-10-05-system-completion.md), tasks 1–4. Read AGENT/memory/PROGRESS/ESSENTIALS, security, ARCHITECTURE §§6–8/10 and DESIGN/pages; preserve P4g work/closure gates.

## Approved direction

Normal MD/TXT/DOCX/text-PDF files -> browser extraction/editable preview -> compact canonical text/numbered clauses -> existing tenant encryption/validated AI proposal -> HR approval. Original files stay local; scanned/mixed PDFs flag OCR required. No image-AI, password-protected document support or forced PDF storage. Existing CSV remains; XLSX follows S70.

Owner confirmed inclusive actual calendar-day proration for SALARIED/RETAINER only; hourly uses actual approved hours. Preserve half-up component rounding and no double subtraction of employment-excluded days as unpaid leave. DOCX rendered page counts cannot be reliably enforced without layout: approved amendment uses existing text/clause bounds plus <=20 MB inflated data/1,000 ZIP entries per document. Approved aggregate limit: <=10 files/20 MB combined originals, each <=10 MB.

## Done when — required security rows

| ID | Acceptance/tests | Status |
|---|---|---|
| S69 | Accessible browse/drop; safe local extraction; no macros/scripts/link/embedded-object execution; 10 MB source/100-page PDF/500-clause/40,000-total-character/2,000-per-clause bounds; server revalidation/hash; encrypted provenance; no raw files. `tests/unit/ingest/documents.test.ts`, injection invariants, `tests/db/ai-config.test.ts`. DOCX limit amendment approved above. | implemented locally; unit/invariant checks pass; DB/browser acceptance pending |
| S70 | XLSX values-only -> existing anonymised CSV path; no formulas/macros evaluated; S25 limits/currency/local name privacy. `tests/unit/ingest/xlsx.test.ts`, ingestion checks/browser payload review. | implemented locally; unit/invariant checks pass; DB/browser acceptance pending |
| S71 | Code-derived personal > group > multi-group > company; equal-level clash blocks approval; explicit override confirmation; coverage/duplicates and trace of both winning and overridden rules. `tests/invariants/config/scope.test.ts`, config/worker DB tests. | implemented locally; unit/invariant checks pass; DB/browser acceptance pending |
| S72 | Company/clause-hash/model/provider/prompt/schema-bound cache; revalidation/immutable execution/audit/HR approval; no tenant/version leaks. Tenant-scoped DB candidates support exact-hash and bounded server-decrypted near-duplicate warnings only, with no plaintext index; deterministic rule/scope checks decide conflict. `tests/unit/ai/cache.test.ts`, `tests/db/ai-cache.test.ts` check cache and warning isolation/matches. | implemented locally; unit/invariant checks pass; DB/browser acceptance pending |
| S73 | HR-entered additions/fixed deductions with reason/caps/encryption; approved proration; immutable snapshot/trace/hash and approval invalidation. `tests/invariants/engine/additions.test.ts`, engine/calculate/snapshot tests. | implemented locally; unit/invariant checks pass; DB/browser acceptance pending |

Retain S21–S22 untrusted-input controls, S25/S42 import/name-key privacy, S41 encryption, S61 tenant membership and all financial/immutable-record guarantees. Align current 200-clause schemas/callers/AI inputs together to the approved 500 ceiling. Worker metadata/local name reveal follow the full plan.

Behavioral tests fail before implementation; spec review precedes quality review. Run targeted checks plus lint/typecheck/unit/DB/build and affected browser acceptance. Record genuine environment/provider results; planned rows never become verified merely because this file exists. Follow normal phase branches/PR/secret-check process.
