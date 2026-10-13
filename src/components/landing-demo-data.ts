// Sample data for the landing-page payroll demo. It copies the approved mockup (docs/mockups/payroll-table.html): the company
// "Northwind Remote" and its people are invented, money is Arc testnet USDC in SIMULATION. Nothing here comes from the database.
import w001 from "@/assets/demo-avatars/W001.jpg";
import w002 from "@/assets/demo-avatars/W002.jpg";
import w003 from "@/assets/demo-avatars/W003.jpg";
import w004 from "@/assets/demo-avatars/W004.jpg";
import w005 from "@/assets/demo-avatars/W005.jpg";
import w006 from "@/assets/demo-avatars/W006.jpg";
import w007 from "@/assets/demo-avatars/W007.jpg";
import w008 from "@/assets/demo-avatars/W008.jpg";
import w009 from "@/assets/demo-avatars/W009.jpg";
import w010 from "@/assets/demo-avatars/W010.jpg";
import w011 from "@/assets/demo-avatars/W011.jpg";
import w012 from "@/assets/demo-avatars/W012.jpg";
import w013 from "@/assets/demo-avatars/W013.jpg";
import w014 from "@/assets/demo-avatars/W014.jpg";
import type { StaticImageData } from "next/image";

export type TagTone = "gray" | "brown" | "yellow" | "green" | "blue" | "purple" | "pink";
export type CheckKind = "matched" | "review" | "hold";
export type Tag = [TagTone, string];

export type DemoWorker = {
  code: string;
  name: string;
  check: CheckKind;
  job: Tag;
  dept: Tag;
  type: Tag;
  expense: Tag;
  monthly: string;
  taxPct: string;
  tax: string;
  monthlyCost: string;
  annual: string;
  annualCost: string;
  raisePct: string;
  raise: string;
  after: string;
  start: string;
  months: number;
  paid: string;
};

export const avatars: Record<string, StaticImageData> = { W001: w001, W002: w002, W003: w003, W004: w004, W005: w005, W006: w006, W007: w007, W008: w008, W009: w009, W010: w010, W011: w011, W012: w012, W013: w013, W014: w014 };

export const workers: DemoWorker[] = [
  { code: "W001", name: "Ava Chen", check: "matched", job: ["pink", "CEO & Co-founder"], dept: ["green", "Management"], type: ["blue", "Salaried"], expense: ["gray", "G&A"], monthly: "$9,000.00", taxPct: "7.65%", tax: "$688.50", monthlyCost: "$9,688.50", annual: "$108,000.00", annualCost: "$116,262.00", raisePct: "0%", raise: "$0.00", after: "$9,000.00", start: "January 1, 2025", months: 21, paid: "$189,000.00" },
  { code: "W002", name: "Marcus Bell", check: "matched", job: ["gray", "CTO"], dept: ["blue", "Engineering"], type: ["blue", "Salaried"], expense: ["blue", "R&D"], monthly: "$8,500.00", taxPct: "7.65%", tax: "$650.25", monthlyCost: "$9,150.25", annual: "$102,000.00", annualCost: "$109,803.00", raisePct: "5%", raise: "$425.00", after: "$8,925.00", start: "January 1, 2025", months: 21, paid: "$178,500.00" },
  { code: "W003", name: "Sofia Ramos", check: "matched", job: ["green", "Head of Sales"], dept: ["pink", "Sales"], type: ["brown", "Retainer"], expense: ["pink", "S&M"], monthly: "$6,000.00", taxPct: "0%", tax: "$0.00", monthlyCost: "$6,000.00", annual: "$72,000.00", annualCost: "$72,000.00", raisePct: "5%", raise: "$300.00", after: "$6,300.00", start: "June 1, 2025", months: 16, paid: "$96,000.00" },
  { code: "W004", name: "Kenji Watanabe", check: "review", job: ["brown", "Front-end developer"], dept: ["blue", "Engineering"], type: ["purple", "Hourly"], expense: ["blue", "R&D"], monthly: "$6,390.00", taxPct: "0%", tax: "$0.00", monthlyCost: "$6,390.00", annual: "$76,680.00", annualCost: "$76,680.00", raisePct: "0%", raise: "$0.00", after: "$6,390.00", start: "February 1, 2026", months: 8, paid: "$51,120.00" },
  { code: "W005", name: "Lena Fischer", check: "matched", job: ["blue", "HR lead"], dept: ["brown", "People"], type: ["blue", "Salaried"], expense: ["gray", "G&A"], monthly: "$5,200.00", taxPct: "7.65%", tax: "$397.80", monthlyCost: "$5,597.80", annual: "$62,400.00", annualCost: "$67,173.60", raisePct: "3%", raise: "$156.00", after: "$5,356.00", start: "September 1, 2025", months: 13, paid: "$67,600.00" },
  { code: "W006", name: "Tomás Ortega", check: "matched", job: ["yellow", "Junior developer"], dept: ["blue", "Engineering"], type: ["purple", "Hourly"], expense: ["blue", "R&D"], monthly: "$3,360.00", taxPct: "0%", tax: "$0.00", monthlyCost: "$3,360.00", annual: "$40,320.00", annualCost: "$40,320.00", raisePct: "0%", raise: "$0.00", after: "$3,360.00", start: "April 1, 2026", months: 6, paid: "$20,160.00" },
  { code: "W007", name: "Priya Nair", check: "matched", job: ["purple", "Product designer"], dept: ["yellow", "Design"], type: ["brown", "Retainer"], expense: ["blue", "R&D"], monthly: "$4,800.00", taxPct: "0%", tax: "$0.00", monthlyCost: "$4,800.00", annual: "$57,600.00", annualCost: "$57,600.00", raisePct: "4%", raise: "$192.00", after: "$4,992.00", start: "November 1, 2025", months: 11, paid: "$52,800.00" },
  { code: "W008", name: "Daniel Okafor", check: "matched", job: ["pink", "Developer"], dept: ["blue", "Engineering"], type: ["blue", "Salaried"], expense: ["blue", "R&D"], monthly: "$6,500.00", taxPct: "7.65%", tax: "$497.25", monthlyCost: "$6,997.25", annual: "$78,000.00", annualCost: "$83,967.00", raisePct: "4%", raise: "$260.00", after: "$6,760.00", start: "March 1, 2025", months: 19, paid: "$123,500.00" },
  { code: "W009", name: "Mei Lin", check: "matched", job: ["gray", "Graphic designer"], dept: ["yellow", "Design"], type: ["purple", "Hourly"], expense: ["pink", "S&M"], monthly: "$2,432.00", taxPct: "0%", tax: "$0.00", monthlyCost: "$2,432.00", annual: "$29,184.00", annualCost: "$29,184.00", raisePct: "0%", raise: "$0.00", after: "$2,432.00", start: "June 1, 2026", months: 4, paid: "$9,728.00" },
  { code: "W010", name: "Jonas Berg", check: "matched", job: ["green", "VP of Marketing"], dept: ["purple", "Marketing"], type: ["brown", "Retainer"], expense: ["pink", "S&M"], monthly: "$7,000.00", taxPct: "0%", tax: "$0.00", monthlyCost: "$7,000.00", annual: "$84,000.00", annualCost: "$84,000.00", raisePct: "5%", raise: "$350.00", after: "$7,350.00", start: "August 1, 2025", months: 14, paid: "$98,000.00" },
  { code: "W011", name: "Amara Diallo", check: "matched", job: ["brown", "Customer support"], dept: ["gray", "Support"], type: ["purple", "Hourly"], expense: ["yellow", "COGS"], monthly: "$3,520.00", taxPct: "0%", tax: "$0.00", monthlyCost: "$3,520.00", annual: "$42,240.00", annualCost: "$42,240.00", raisePct: "0%", raise: "$0.00", after: "$3,520.00", start: "January 1, 2026", months: 9, paid: "$31,680.00" },
  { code: "W012", name: "Ravi Shah", check: "matched", job: ["blue", "Data analyst"], dept: ["brown", "Operations"], type: ["blue", "Salaried"], expense: ["gray", "G&A"], monthly: "$5,600.00", taxPct: "7.65%", tax: "$428.40", monthlyCost: "$6,028.40", annual: "$67,200.00", annualCost: "$72,340.80", raisePct: "3%", raise: "$168.00", after: "$5,768.00", start: "March 1, 2026", months: 7, paid: "$39,200.00" },
  { code: "W013", name: "Elena Petrova", check: "matched", job: ["yellow", "Legal counsel"], dept: ["gray", "Legal"], type: ["brown", "Retainer"], expense: ["gray", "G&A"], monthly: "$3,000.00", taxPct: "0%", tax: "$0.00", monthlyCost: "$3,000.00", annual: "$36,000.00", annualCost: "$36,000.00", raisePct: "0%", raise: "$0.00", after: "$3,000.00", start: "May 1, 2026", months: 5, paid: "$15,000.00" },
  { code: "W014", name: "Noah Kim", check: "hold", job: ["purple", "DevOps engineer"], dept: ["blue", "Engineering"], type: ["purple", "Hourly"], expense: ["blue", "R&D"], monthly: "$7,800.00", taxPct: "0%", tax: "$0.00", monthlyCost: "$7,800.00", annual: "$93,600.00", annualCost: "$93,600.00", raisePct: "0%", raise: "$0.00", after: "$7,800.00", start: "December 1, 2025", months: 10, paid: "$78,000.00" },
];

/** Column definitions: label and where the number comes from (shown on hover and when a cell is selected). */
export const columns = [
  { key: "check", label: "Check", source: "Matched, needs review or on hold" },
  { key: "job", label: "Job title", source: "" },
  { key: "dept", label: "Department", source: "" },
  { key: "type", label: "Pay type", source: "" },
  { key: "expense", label: "Expense type", source: "" },
  { key: "monthly", label: "Monthly pay", source: "Worker record, or Hours × Rate for hourly" },
  { key: "taxPct", label: "Payroll tax %", source: "Pay policy v3 §4" },
  { key: "tax", label: "Payroll tax", source: "Monthly pay × Payroll tax %" },
  { key: "monthlyCost", label: "Monthly cost", source: "Monthly pay + Payroll tax" },
  { key: "annual", label: "Annual pay", source: "Monthly pay × 12" },
  { key: "annualCost", label: "Annual cost", source: "Monthly cost × 12" },
  { key: "raisePct", label: "Annual increase %", source: "Worker record (next review)" },
  { key: "raise", label: "Monthly increase", source: "Monthly pay × Annual increase %" },
  { key: "after", label: "Monthly after increase", source: "Monthly pay + Monthly increase" },
  { key: "start", label: "Start date", source: "Worker record" },
  { key: "months", label: "Months paid", source: "Count of settled payments" },
  { key: "paid", label: "Total paid", source: "Sum of settled payments" },
] as const;
export type ColumnKey = (typeof columns)[number]["key"];

export const footer: Partial<Record<ColumnKey, string>> = {
  monthly: "Sum $79,102.00", taxPct: "Average 2.73%", tax: "Sum $2,662.20", monthlyCost: "Sum $81,764.20", annual: "Sum $949,224.00", annualCost: "Sum $981,170.40",
  raisePct: "Average 2.07%", raise: "Sum $1,851.00", after: "Sum $80,953.00", months: "Sum 164", paid: "Sum $1,050,288.00",
};

/** Past months: same people and rates, Kenji's hours differ (his pay is hours × $45) and every check is already resolved. */
export type DemoMonth = { label: string; run: number; kenjiHours: number };
export const months: DemoMonth[] = [
  { label: "October 2026", run: 10, kenjiHours: 142 },
  { label: "September 2026", run: 9, kenjiHours: 138 },
  { label: "August 2026", run: 8, kenjiHours: 130 },
  { label: "July 2026", run: 7, kenjiHours: 120 },
];
export const KENJI_RATE = 45;

export const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const parseUsd = (s: string) => Number(s.replace(/[^0-9.-]/g, "")) || 0;

/** The 14 workers as they stand in month index k (0 = current run). */
export function monthRows(k: number): DemoWorker[] {
  return workers.map((w) => {
    const kenji = w.code === "W004";
    const pay = kenji ? months[k].kenjiHours * KENJI_RATE : parseUsd(w.monthly);
    const base: DemoWorker = kenji ? { ...w, monthly: usd(pay), monthlyCost: usd(pay), annual: usd(pay * 12), annualCost: usd(pay * 12), after: usd(pay) } : { ...w };
    return { ...base, check: k > 0 ? "matched" : w.check, months: Math.max(0, w.months - k), paid: usd(Math.max(0, parseUsd(w.paid) - k * pay)) };
  });
}

export function monthSummary(rows: DemoWorker[]) {
  const sum = (f: (w: DemoWorker) => number) => rows.reduce((a, w) => a + f(w), 0);
  return {
    workers: rows.length,
    matched: rows.filter((w) => w.check === "matched").length,
    review: rows.filter((w) => w.check === "review").length,
    hold: rows.filter((w) => w.check === "hold").length,
    total: sum((w) => parseUsd(w.monthly)),
    footer: {
      monthly: "Sum " + usd(sum((w) => parseUsd(w.monthly))),
      taxPct: footer.taxPct,
      tax: "Sum " + usd(sum((w) => parseUsd(w.tax))),
      monthlyCost: "Sum " + usd(sum((w) => parseUsd(w.monthlyCost))),
      annual: "Sum " + usd(sum((w) => parseUsd(w.annual))),
      annualCost: "Sum " + usd(sum((w) => parseUsd(w.annualCost))),
      raisePct: footer.raisePct,
      raise: "Sum " + usd(sum((w) => parseUsd(w.raise))),
      after: "Sum " + usd(sum((w) => parseUsd(w.after))),
      months: "Sum " + sum((w) => w.months),
      paid: "Sum " + usd(sum((w) => parseUsd(w.paid))),
    } as Partial<Record<ColumnKey, string>>,
  };
}
