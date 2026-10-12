# P4r synthetic retrieval evaluation

Status: local synthetic evaluation passed on 2026-10-06. The focused retrieval suite passed 9 tests; the 11-scenario evaluator exited successfully at both dimensions. This report covers only the deterministic in-memory synthetic corpus. It does not measure Gemini, any other external embedding model, real policy language, database retrieval, provider latency or semantic answer quality.

Reproduce with `npm test -- tests/invariants/knowledge/retrieval.test.ts` and then `npm exec tsx tests/fixtures/knowledge/evaluate.ts` from the repository root. The evaluator makes no network calls and uses no credentials. The same fixed 11 scenarios are evaluated at vector dimensions 768 and 1536 using `token-hash-v1`; changing vector length tests this fixture implementation's collision/ranking behavior only. No conclusion that either dimension is better for real embeddings follows from these results. External embedding cost is not applicable to this run; it is not a price estimate for a future provider.

The evaluator reports Recall@3, exact-ID precedence among cases that returned an exact match, missing/conflict escalation, tenant leaks, disallowed-version returns, unsupported accepted claims, scenario failures and in-process p50/p95 latency. Latency includes only this local synthetic retrieval and validation path. Safety counts must be zero, and required escalation must be 100%, before treating the synthetic checks as passing.

## Results

Measured in a sequential local run on October 6, 2026; the fixture hashes identify the evaluated corpus.

| Metric | 768 | 1536 |
|---|---:|---:|
| Fixture hash | `75847ceac9685f05d10248564fdcbaada96ef85d4c4ec4c3f5fa29f8e9b8778f` | `ddc75fba05588005e4d5a15fc29bcba940998a8d057c9d0b2f4d698308b03b1f` |
| Scenarios | 11 | 11 |
| Recall@3 | 1.00 | 1.00 |
| Exact-ID precedence | 6/6 (1.00) | 6/6 (1.00) |
| All expected-review escalation | 1.00 | 1.00 |
| Missing/conflict escalation (3 cases) | 1.00 | 1.00 |
| Tenant failures | 0 | 0 |
| Disallowed-version overrides | 0 | 0 |
| Unsupported accepted claims | 0 | 0 |
| Failed scenarios | 0 | 0 |
| In-process latency p50 / p95 (ms) | 3.5127 / 33.4221 | 2.4904 / 3.2703 |

The focused retrieval invariant file passed all 9 tests after the duplicate approved-extra-hours check was added. External embedding calls and external provider cost: none. The latency samples are local in-process runs and are not provider or database timings.

## Limits

Synthetic token hashing is a deterministic stand-in with hand-authored token normalization. It has no learned semantic space, provider behavior, or production storage. Passing these scenarios demonstrates bounded code behavior against these fixtures only; it does not establish retrieval accuracy on real clauses. Real-data evaluation remains gated on the privacy/storage decision and provider data-use review. Do not describe this as a Gemini or real embedding quality comparison.
