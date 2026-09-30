import { canonicalHash } from "../canonical";
import { roundHalfUpToCent, type MicroUsdc } from "../money";

// P1: fixed-amount pay only (SALARIED base per period, RETAINER). HOURLY, deductions and
// percentages arrive with the full engine in P2.
export type PayType = "SALARIED" | "HOURLY" | "RETAINER";

export interface EngineWorker {
  workerId: string;
  payType: PayType;
  baseAmount: MicroUsdc;
}

export interface TraceLine {
  component: string;
  source: string;
  rule: string;
  ruleVersion: number;
  inputs: Record<string, string>;
  step: number;
  amount: MicroUsdc;
}

export interface PayrollLine {
  workerId: string;
  gross: MicroUsdc;
  deductions: MicroUsdc;
  net: MicroUsdc;
  trace: TraceLine[];
}

export interface PayrollCalculation {
  configVersion: number;
  lines: PayrollLine[];
  calculationHash: string;
}

export function calculatePayroll(configVersion: number, workers: EngineWorker[]): PayrollCalculation {
  const lines = [...workers]
    .sort((a, b) => (a.workerId < b.workerId ? -1 : 1))
    .map((w): PayrollLine => {
      if (w.payType === "HOURLY") throw new Error("HOURLY pay is not supported before P2");
      const gross = roundHalfUpToCent(w.baseAmount);
      const deductions = 0n;
      return {
        workerId: w.workerId,
        gross,
        deductions,
        net: gross - deductions,
        trace: [
          {
            component: "base",
            source: "worker.base_amount",
            rule: w.payType === "SALARIED" ? "BASE_SALARY" : "RETAINER_FIXED",
            ruleVersion: 1,
            inputs: { baseAmount: w.baseAmount.toString() },
            step: 1,
            amount: gross,
          },
        ],
      };
    });
  return { configVersion, lines, calculationHash: canonicalHash({ configVersion, lines }) };
}
