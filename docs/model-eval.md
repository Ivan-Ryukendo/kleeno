# Model and evidence evaluation

Prepared October 6, 2026. Distinguish pipeline checks, synthetic retrieval and real-provider performance.

## Existing synthetic evidence

[P4r synthetic evaluation](p4r-synthetic-evaluation.md) records 11 fixed scenarios at 768/1536 and nine focused checks from the earlier build. Its embeddings are token hashes. Those results test filtering, exact-ID priority, evidence support and escalation contracts; they do not measure Gemini semantic quality, provider latency or production privacy. Do not relabel historical checks as this session's execution.

## Consolidated regression evidence

Current validation results belong in [P4/P5 readiness](p4-p5-readiness.md) and PROGRESS. Unit/mocked/cache-backed browser results prove their stated contracts, not real OpenRouter inference. The new browser intake deliberately uses a synthetic encrypted cache while disabling external provider calls.

## Real model evaluation: pending

Use existing `scripts/model-eval.ts` only with the approved synthetic policy fixture, configured provider/model and bounded run count (1–10 per model). Select models and spending cap before provider execution. Record exact model/provider versions, fixture/prompt/schema revision, attempts, ACCEPTED/REPAIRED/NEEDS_HUMAN_REVIEW counts, observed latency, usage/cost from provider evidence and unsupported accepted claims. A status count alone is not payroll accuracy.

Do not manufacture measurements absent from the script or provider records. Freeze fixture expectations before comparing models. Retain deterministic money/hash, human approval, tenant isolation, missing/conflicting-evidence escalation and zero unsupported consequential claims. Real-policy embedding/searchable storage remains gated by classification, provider terms, retention/deletion and reviewed security tests. No real-provider experiment is claimed by this document.
