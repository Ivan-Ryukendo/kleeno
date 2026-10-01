// PROTECTED. Synthetic engine fixtures (rule 42): input + expected result in whole USDC strings.
import type { PayrollConfig } from "@/core/config";
import type { EngineEntry } from "@/core/engine";
import { parseUsdc } from "@/core/money";

export const CONFIG: PayrollConfig = {
  version: 1,
  scheduledHoursPerPeriod: "40",
  weeklyOvertimeThresholdHours: "40",
  overtimeMultiplier: "1.5",
  hourlyCapHours: "40",
  aboveCapMultiplier: "1.5",
  deductions: [
    { code: "TAX", label: "Tax", percent: "10" },
    { code: "PENSION", label: "Pension", percent: "5" },
  ],
  varianceTolerance: "0.01",
  rules: [],
};

const salaried = (id: string, base = "2000") => ({ workerId: id, payType: "SALARIED" as const, baseAmount: parseUsdc(base), hourlyRate: 0n });

export interface Case {
  name: string;
  config?: PayrollConfig;
  entry: EngineEntry;
  gross: string;
  deductions: string;
  net: string;
}

export const CASES: Case[] = [
  { name: "normal salary", entry: { worker: salaried("w1"), input: { workedHours: "40" } }, gross: "2000", deductions: "300", net: "1700" },
  { name: "40 scheduled / 48 worked / 8 approved overtime", entry: { worker: salaried("w2"), input: { workedHours: "48", approvedOvertimeHours: "8" } }, gross: "2600", deductions: "390", net: "2210" },
  { name: "32 worked + 8 paid leave", entry: { worker: salaried("w3"), input: { workedHours: "32", paidLeaveHours: "8" } }, gross: "2000", deductions: "300", net: "1700" },
  { name: "36 worked + 4 unpaid leave (resolved)", entry: { worker: salaried("w4"), input: { workedHours: "36", unpaidLeaveHours: "4" } }, gross: "1800", deductions: "270", net: "1530" },
  {
    name: "hourly: approved above-cap paid, unapproved excluded",
    entry: { worker: { workerId: "w5", payType: "HOURLY", baseAmount: 0n, hourlyRate: parseUsdc("30") }, input: { workedHours: "44", approvedAboveCapHours: "2" } },
    gross: "1290",
    deductions: "193.5",
    net: "1096.5",
  },
  {
    name: "retainer: fixed amount plus approved extra hours",
    entry: { worker: { workerId: "w6", payType: "RETAINER", baseAmount: parseUsdc("1500"), hourlyRate: parseUsdc("40") }, input: { approvedExtraHours: "2" } },
    gross: "1580",
    deductions: "237",
    net: "1343",
  },
  {
    name: "repeating hourly rate rounds once, half-up",
    config: { ...CONFIG, scheduledHoursPerPeriod: "7", deductions: [] },
    entry: { worker: salaried("w7", "1000"), input: { unpaidLeaveHours: "1" } },
    gross: "857.14",
    deductions: "0",
    net: "857.14",
  },
];
