// Variance report (ARCHITECTURE 16, the SIMULATION value): what the business actually paid vs what the engine says each worker
// should receive (net). Pure and exact. Each difference above the configured tolerance is a finding; the engine is never changed.
export type VarianceKind = "UNDERPAID" | "OVERPAID" | "NOT_PAID" | "NOT_IN_PAYROLL";

export interface VarianceFinding {
  workerId: string;
  kind: VarianceKind;
  expected: bigint; // micro-USDC, from the engine
  actual: bigint; // micro-USDC, from the imported amounts actually paid
  difference: bigint; // actual - expected
}

const abs = (n: bigint) => (n < 0n ? -n : n);

/** `actual` holds the summed paid amount per worker; `tolerance` is in micro-USDC. Sorted by worker for a stable report. */
export function compareVariance(lines: { workerId: string; net: bigint }[], actual: ReadonlyMap<string, bigint>, tolerance: bigint): VarianceFinding[] {
  const findings: VarianceFinding[] = [];
  const expectedBy = new Map(lines.map((l) => [l.workerId, l.net]));
  for (const [workerId, expected] of expectedBy) {
    const paid = actual.get(workerId);
    if (paid === undefined) {
      if (expected > tolerance) findings.push({ workerId, kind: "NOT_PAID", expected, actual: 0n, difference: -expected });
      continue;
    }
    const difference = paid - expected;
    if (abs(difference) > tolerance) findings.push({ workerId, kind: difference > 0n ? "OVERPAID" : "UNDERPAID", expected, actual: paid, difference });
  }
  for (const [workerId, paid] of actual) if (!expectedBy.has(workerId) && paid > tolerance) findings.push({ workerId, kind: "NOT_IN_PAYROLL", expected: 0n, actual: paid, difference: paid });
  return findings.sort((a, b) => (a.workerId < b.workerId ? -1 : a.workerId > b.workerId ? 1 : 0));
}
