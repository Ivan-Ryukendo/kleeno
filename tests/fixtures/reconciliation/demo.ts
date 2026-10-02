// PROTECTED. The six-worker demo cast (PRD section 7) as reconciliation evidence. Synthetic, one ISO week (rule 42).
import type { ReconInput, ReconLeave, ReconTimesheet } from "@/core/reconciliation";

export const PERIOD = { start: "2026-10-05", end: "2026-10-11" }; // Monday-Sunday: five weekdays
export const DAYS = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];

let seq = 0;
export const ts = (workerId: string, date: string, hours: string, approvedExtraHours = "0", s = ++seq): ReconTimesheet => ({ id: `ts-${s}`, workerId, date, hours, approvedExtraHours, seq: s });
export const lv = (workerId: string, date: string, leaveType: "PAID" | "UNPAID", hours: string, s = ++seq): ReconLeave => ({ id: `lv-${s}`, workerId, date, leaveType, hours, seq: s });
const week = (workerId: string, hoursPerDay: string[]) => DAYS.map((d, i) => ts(workerId, d, hoursPerDay[i]));

export const CONFIG = { scheduledHoursPerPeriod: "40", weeklyOvertimeThresholdHours: "40", hourlyCapHours: "40" };

// W001 retainer (normal) · W002 hourly 48h with 8 approved above cap · W003 salaried 32 worked + 8 paid leave
// W004 salaried 36 worked, no leave · W005 hourly with a duplicated timesheet line · W006 salaried with work and leave on one day
export function demo(): ReconInput {
  return {
    config: CONFIG,
    period: PERIOD,
    workers: [
      { id: "W001", payType: "RETAINER" },
      { id: "W002", payType: "HOURLY" },
      { id: "W003", payType: "SALARIED" },
      { id: "W004", payType: "SALARIED" },
      { id: "W005", payType: "HOURLY" },
      { id: "W006", payType: "SALARIED" },
    ],
    timesheets: [
      ...week("W001", ["8", "8", "8", "8", "8"]),
      ts("W002", DAYS[0], "10"), ts("W002", DAYS[1], "10"), ts("W002", DAYS[2], "10"), ts("W002", DAYS[3], "10", "8"), ts("W002", DAYS[4], "8"),
      ...week("W003", ["8", "8", "8", "8", "0"]),
      ...week("W004", ["8", "7", "7", "7", "7"]),
      ...week("W005", ["8", "8", "8", "8", "8"]),
      ts("W005", DAYS[2], "8"), // the same day again: a duplicated line
      ts("W006", DAYS[0], "8"), ts("W006", DAYS[1], "8"), ts("W006", DAYS[2], "8"), ts("W006", DAYS[3], "8"),
      ts("W006", DAYS[4], "8"), // works on the day that is also leave
    ],
    leave: [lv("W003", DAYS[4], "PAID", "8"), lv("W006", DAYS[4], "PAID", "8")],
  };
}
