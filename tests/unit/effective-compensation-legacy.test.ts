import { expect, it } from "vitest";
import { calculatePayroll, type EngineEntry } from "@/core/engine";
import { parseUsdc } from "@/core/money";
import { CASES, CONFIG } from "../fixtures/payroll/cases";

it("preserves captured legacy hashes when entries omit the prospective segmented contract", () => {
  const employment: EngineEntry = { worker: { workerId: "legacy-employed", payType: "SALARIED", baseAmount: parseUsdc("3100"), hourlyRate: 0n, employmentStart: "2026-01-16", employmentEnd: null }, period: { start: "2026-01-01", end: "2026-01-31" }, input: { unpaidLeaveHours: "8", unpaidLeave: [{ date: "2026-01-20", hours: "8" }], adjustments: [{ id: "legacy-bonus", kind: "BONUS", amount: "100.005", reason: "Reviewed fixture bonus" }] } };
  const hashes = [
    ...CASES.map(value => calculatePayroll(value.config ?? CONFIG, [value.entry]).calculationHash),
    calculatePayroll({ ...CONFIG, deductions: [], prorationMethod: "ACTUAL_CALENDAR_DAYS" }, [employment]).calculationHash,
  ];
  // Captured October 8 before any segmented-engine implementation; protected fixtures stay untouched.
  expect(hashes).toEqual([
    "1dcddc7bdb20278bedb6beb574ca4604f89358dddb2ddd5e503f68d0a59d915c",
    "9defc4fea44a68f39fc24bdb637e4f2547da6841218f0f2fef63721b3bb8ace5",
    "9cc78457591de1270fad8aedc3dd504605c7d22dc55d30c25d868ca7f915942b",
    "3db7732b8cb3d6db1b5b4335f5e7fd8327eb6b35131c5b55e496979ab7069dec",
    "98b3a0b2e0e5adebf6a6a31dd78dce04993963548d66a9665858c3aa6e0c5b3d",
    "a65438f814060415dfb1e77f31be347b342a1825e7b592ff78312cbb6536c332",
    "3eb88fac2bf5cbce0ae84da6eaf304f66f764562c6da54fb44a4dbbd7b37946d",
    "b0954291331fb9a225022684a06398eb89b75eff9f6701c91a1483a9f82e929e",
  ]);
});
