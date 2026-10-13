// The graphs behind the Workflow tab of the landing-page demo. Pure data, no React.
//
// Two scopes: "company" (the whole run, for everyone) and "person" (one worker, every step with its sources).
// Three levels of detail: simplified (a few steps), complex (each calculation function is its own step) and detailed
// (every input is its own card, with where it is stored and which document it came from).
//
// Principle shown on the page: AI only reads what the company provides. Every card names where its data is stored
// (store) and which document, import or approval it came from (from); numbers are calculated by plain code.
// The company figures agree with docs/mockups/payroll-table.html; Daniel Okafor's steps are those of payroll-calculation.html.

import { KENJI_RATE, months, monthRows, monthSummary, parseUsd, usd, workers } from "@/components/landing-demo-data";

export type Scope = "company" | "person";
export type Detail = "simple" | "complex" | "detailed";
export type Prov = "document" | "import" | "record" | "code" | "approval";
export type Tone = "ok" | "warn" | "lock" | "prop";
export type PersonId = string;

export const provLabel: Record<Prov, string> = { document: "Document", import: "Import", record: "Record", code: "Code", approval: "Approval" };
export const provHelp: Record<Prov, string> = {
  document: "Read from a document you provided. AI proposed the rule; HR approved it.",
  import: "Imported from your file. Names are replaced by worker codes before upload.",
  record: "Entered by your team in a worker or leave record.",
  code: "Calculated by plain code from the inputs on its left. The same inputs always give the same result.",
  approval: "Signed by a person. Nothing moves without it.",
};

export type Row = { k: string; v: string; src?: string[] };
export type Info = { sub: string; lines?: string[]; calc?: Row[]; total?: Row; note?: string };
export type GNode = {
  id: string; col: number; row: number; group: string;
  title: string; tag: string; stat: string; text: string; tone: Tone;
  prov: Prov; store: string; from: string; info: Info;
};
export type Graph = { nodes: GNode[]; edges: [string, string][] };


const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Daniel Okafor, October 2026: the 18 steps of payroll-calculation.html, in the order they run. */
export function danielTrace() {
  const base = r2(78000 / 12);
  const sched = 8 * 22;
  const eq = base / sched;
  const ot = r2(6 * eq * 1.5);
  const stipend = 150;
  const wages = r2(base + ot + stipend);
  const reimb = 79;
  const gross = r2(wages + reimb);
  const pension = r2(wages * 0.05);
  const tax = r2((wages - pension) * 0.12);
  const ss = r2(wages * 0.062);
  const medicare = r2(wages * 0.0145);
  const deductions = r2(pension + tax + ss + medicare);
  const net = r2(gross - deductions);
  return { base, sched, eq, ot, stipend, wages, reimb, gross, pension, tax, ss, medicare, deductions, net, erTax: r2(wages * 0.0765), match: r2(wages * 0.04) };
}

/** Kenji Watanabe, hourly contractor: hours x rate, paid in full (no withholding). */
export function kenjiTrace(monthIdx: number) {
  const hours = months[monthIdx].kenjiHours;
  return { hours, rate: KENJI_RATE, pay: r2(hours * KENJI_RATE), cap: 140, over: Math.max(0, hours - 140) };
}

type Seed = Omit<GNode, "tone" | "prov" | "store" | "from"> & Partial<Pick<GNode, "tone" | "prov" | "store" | "from">>;
const node = (s: Seed): GNode => ({ tone: "ok", prov: "code", store: "Calculated when you open this page", from: "Inputs on the left", ...s });

const stackNodes = (col: number, rowReview: number, rowPay: number, rowAudit: number, net: string, who: string): GNode[] => [
  node({ id: "review", col, row: rowReview, group: "Approval and payment", title: "Review & approve", tag: "Step", stat: "2 of 2 signed", text: "Two different people sign", prov: "approval", store: "Approvals log (append-only)", from: "Leo Hart (payroll) and Sam Ortiz (payment plan), Oct 8",
    info: { sub: "Two different people must sign", calc: [{ k: "Payroll approval", v: "Leo Hart · Oct 8" }, { k: "Payment plan", v: "Sam Ortiz · Oct 8" }], note: `${who}: ${net}. Each person re-enters their password to sign.` } }),
  node({ id: "pay", col, row: rowPay, group: "Approval and payment", title: "Payments", tag: "Step", stat: "Locked", text: "Simulation never sends money", tone: "lock", prov: "approval", store: "PayrollGuard contract on Arc testnet", from: "Signed payment plan",
    info: { sub: "Locked in this demo", lines: ["In live mode, approved payments go to a guarded smart contract on Arc and each one gets a receipt. In SIMULATION nothing is sent."] } }),
  node({ id: "audit", col, row: rowAudit, group: "Approval and payment", title: "Audit record", tag: "Step", stat: "Immutable", text: "Every step above is written here", prov: "record", store: "audit_log (append-only)", from: "Every card in this workflow",
    info: { sub: "Cannot be edited afterwards", lines: ["Who changed what, when, and why. Open the Activity tab to read it."] } }),
];
const stackEdges: [string, string][] = [["review", "pay"], ["pay", "audit"]];

/* ------------------------------------------------------------------------------------------------ company */

export function companyGraph(detail: Detail, monthIdx: number): Graph {
  const m = months[monthIdx];
  const s = monthSummary(monthRows(monthIdx));
  const total = usd(s.total);
  const issues = s.review + s.hold;
  const reconText = issues ? `${s.review} needs review · ${s.hold} on hold` : "All matched";
  const csvName = `timesheets-${m.label.split(" ")[0].toLowerCase()}.csv`;
  const additions = monthIdx === 0 ? 332.39 + 750 : 750;

  const recon = (id: string, col: number, row: number): GNode =>
    node({ id, col, row, group: "Checks", title: "Reconcile", tag: "Step 1", stat: `${s.matched} of ${s.workers}`, text: reconText, tone: issues ? "warn" : "ok", prov: "code", store: "reconciliation results", from: `${csvName} compared with worker records`,
      info: { sub: "Do the timesheets match the worker records?", calc: [{ k: "Matched automatically", v: String(s.matched) }, { k: "Needs review", v: String(s.review) }, { k: "On hold", v: String(s.hold) }],
        note: s.review ? "Kenji Watanabe: the timesheet says 142 hours, his contract caps at 140. A person decides before this reaches pay." : undefined } });

  if (detail === "simple") {
    return {
      nodes: [
        node({ id: "inputs", col: 0, row: 1, group: "Inputs", title: "Your inputs", tag: "Source", stat: "3 sources", text: "Pay policy, timesheets, worker records", prov: "document", store: "Policy library, timesheet import, worker records", from: "Provided by your company",
          info: { sub: "Everything Kleeno uses comes from you", lines: ["Pay policy v3 (approved Aug 28), the timesheet import, and the worker records. AI reads them. It never invents a number or a rule.", "Switch to Complex or Detailed to see each source."] } }),
        recon("recon", 1, 1),
        node({ id: "calc", col: 2, row: 1, group: "Calculation", title: "Calculate", tag: "Step 2", stat: total, text: `Base pay for ${s.workers} workers, plus additions`, info: { sub: "Plain code applies the approved rules", calc: [{ k: "Base pay (14 workers)", v: total }, { k: "Additions this run", v: usd(additions) }], note: "Switch to Complex to see each calculation function on its own." } }),
        ...stackNodes(3, 1, 0.5, 1.5, total, "Run total"),
      ].map((n) => (n.id === "pay" ? { ...n, col: 4, row: 0.5 } : n.id === "audit" ? { ...n, col: 4, row: 1.5 } : n)),
      edges: [["inputs", "recon"], ["recon", "calc"], ["calc", "review"], ...stackEdges],
    };
  }

  const sources: GNode[] = [
    node({ id: "csv", col: 0, row: 0.4, group: "Inputs", title: "Timesheet CSV", tag: "Source", stat: `${s.workers} rows`, text: csvName, prov: "import", store: "Import (names replaced by worker codes)", from: "Uploaded by your payroll team",
      info: { sub: "Imported in your browser, names anonymised first", lines: [`${s.workers} rows: worker code, hours, pay period. Row 4 is W004, ${m.kenjiHours} hours.`] } }),
    node({ id: "people", col: 0, row: 1.8, group: "Inputs", title: "Worker records", tag: "Source", stat: `${s.workers} workers`, text: "Rates, pay types, bank details", prov: "record", store: "workers table", from: "Entered by HR",
      info: { sub: "The company's own list of who gets paid", lines: ["Pay type (salaried, hourly, retainer), rate and wallet per worker. 5 employees and 9 contractors."] } }),
    node({ id: "policy", col: 0, row: 3.6, group: "Inputs", title: "Pay policy", tag: "Source", stat: "v3", text: "Approved Sep 28 by Maya Reyes", prov: "document", store: "Policy library · 10 files", from: "Pay policy v3, approved by HR",
      info: { sub: "Where the rules come from", lines: ["Benefits policy, handbooks, agreements and spreadsheets. AI proposed structured rules from the sentences in them; HR approved version 3.", "In the real product each rule links back to the sentence it came from."] } }),
    node({ id: "leaves", col: 0, row: 5, group: "Inputs", title: "Leave records", tag: "Source", stat: "5 requests", text: "9 days off this month", prov: "record", store: "leave_records table", from: "Requested by workers, approved by HR",
      info: { sub: "Paid leave that was approved", lines: ["Leave changes the balance but not the pay in this run. Example: LV-0412, Daniel Okafor, Oct 8–9, approved Oct 1."] } }),
  ];
  const fns: GNode[] = [
    node({ id: "base", col: 3, row: 0, group: "Calculations", title: "Base pay", tag: "Function", stat: total, text: "Salary ÷ 12, hours × rate, retainers fixed", info: { sub: "Each worker's monthly base amount", calc: [{ k: "Salaried (5 employees + 1)", v: "salary ÷ 12", src: ["policy"] }, { k: "Hourly (5 contractors)", v: "hours × rate", src: ["csv", "people"] }, { k: "Retainers", v: "fixed amount", src: ["people"] }], total: { k: "All 14 workers", v: total } } }),
    node({ id: "ot", col: 3, row: 1, group: "Calculations", title: "Overtime & extra hours", tag: "Function", stat: monthIdx === 0 ? "+$332.39" : "$0.00", text: monthIdx === 0 ? "1 worker: release week, 6 h × 1.5" : "No approved extra hours", info: { sub: "Hours above the normal month", calc: [{ k: "Release-week hours (Daniel Okafor)", v: monthIdx === 0 ? "6 h" : "0 h", src: ["csv"] }, { k: "Rate", v: "1.5 × hourly equivalent", src: ["policy"] }], total: { k: "Overtime", v: monthIdx === 0 ? "$332.39" : "$0.00" } } }),
    node({ id: "allow", col: 3, row: 2, group: "Calculations", title: "Allowances", tag: "Function", stat: "+$750.00", text: "5 employees × $150 home office", info: { sub: "Fixed amounts the policy grants", calc: [{ k: "Home office stipend", v: "$150 a month", src: ["policy"] }, { k: "Full-time employees", v: "5", src: ["people"] }], total: { k: "Allowances", v: "$750.00" } } }),
    node({ id: "leave", col: 3, row: 3, group: "Calculations", title: "Leave remaining", tag: "Function", stat: "9 days", text: "Taken this month, no pay change", info: { sub: "Balances after approved leave", calc: [{ k: "Requests approved", v: "5", src: ["leaves"] }, { k: "Days taken", v: "9", src: ["leaves"] }, { k: "Entitlement", v: "20 to 25 days a year", src: ["policy"] }], note: "Paid leave counts as hours worked, so pay does not change." } }),
    node({ id: "tax", col: 3, row: 4, group: "Calculations", title: "Employer payroll tax", tag: "Function", stat: "$2,662.20", text: "7.65% on 5 employees' base pay", info: { sub: "Paid by the company on top of pay", calc: [{ k: "Rate", v: "7.65%", src: ["policy"] }, { k: "Employees' base pay", v: "$34,800.00", src: ["people"] }], total: { k: "Employer payroll tax", v: "$2,662.20" } } }),
  ];
  const result = node({ id: "result", col: 4, row: 2, group: "Result", title: "Run result", tag: "Step 2", stat: total, text: `Base pay + ${usd(additions)} additions`, info: { sub: "What goes to approval", calc: [{ k: "Base pay", v: total, src: ["base"] }, { k: "Overtime & extra hours", v: monthIdx === 0 ? "$332.39" : "$0.00", src: ["ot"] }, { k: "Allowances", v: "$750.00", src: ["allow"] }], total: { k: "Additions on top of base", v: usd(additions) }, note: "The Table tab shows base pay per worker. Click a card to see where each part comes from." } });

  if (detail === "complex") {
    const rules = node({ id: "rules", col: 1, row: 4, group: "Checks", title: "Approved rules", tag: "Step 1", stat: "12 rules", text: "From 5 documents, version 3", prov: "document", store: "pay_rules table (versioned)", from: "Proposed by AI from your documents, approved by HR",
      info: { sub: "Structured pay rules, each linked to a sentence", lines: ["Validation checks every rule for clashes and gaps. Nothing applies until an HR approver accepts a version."] } });
    const stack = stackNodes(5, 1, 2.5, 4, total, "Run total");
    return {
      nodes: [...sources.map((n) => (n.id === "policy" ? { ...n, row: 4 } : n.id === "leaves" ? { ...n, row: 5.4 } : n)), recon("recon", 1, 0.9), rules, ...fns.map((n) => ({ ...n, col: 2 })), { ...result, col: 3, row: 2 }, ...stack.map((n) => ({ ...n, col: 4 }))],
      edges: [["csv", "recon"], ["people", "recon"], ["policy", "rules"], ["recon", "base"], ["recon", "ot"], ["rules", "base"], ["rules", "ot"], ["rules", "allow"], ["rules", "tax"], ["people", "allow"], ["leaves", "leave"], ["rules", "leave"], ["base", "result"], ["ot", "result"], ["allow", "result"], ["leave", "result"], ["tax", "audit"], ["result", "review"], ...stackEdges],
    };
  }

  // detailed: every input is its own card
  const pts: { id: string; fn: string[]; n: GNode }[] = [
    { id: "c_hours", fn: ["base", "ot"], n: node({ id: "c_hours", col: 0, row: 0, group: "Inputs", title: "Hours worked", tag: "Import", stat: `${s.workers} rows`, text: csvName, prov: "import", store: "Import · timesheet rows", from: "Uploaded by your payroll team, matched by Reconcile", info: { sub: "Hours per worker for the period", lines: [`${s.workers} rows: ${s.matched} matched automatically. ${reconText}.`] } }) },
    { id: "c_rates", fn: ["base", "allow"], n: node({ id: "c_rates", col: 0, row: 1, group: "Inputs", title: "Pay types and rates", tag: "Record", stat: `${s.workers} workers`, text: "Salary, hourly rate or retainer", prov: "record", store: "workers.pay_type, workers.rate", from: "Entered by HR in the worker record", info: { sub: "How each person is paid", lines: ["5 employees, 9 contractors: 4 salaried, 5 hourly, 5 retainers."] } }) },
    { id: "c_salary", fn: ["base"], n: node({ id: "c_salary", col: 0, row: 2, group: "Inputs", title: "Salary rule", tag: "Document", stat: "÷ 12", text: "One twelfth of annual salary", prov: "document", store: "pay_rules · salary", from: "Benefits policy v2 §1.2", info: { sub: "Monthly pay for salaried staff", lines: ["Annual salary divided by 12, as written in the Benefits policy."] } }) },
    { id: "c_ot", fn: ["ot"], n: node({ id: "c_ot", col: 0, row: 3, group: "Inputs", title: "Overtime rule", tag: "Document", stat: "1.5 ×", text: "Release weeks, approved first", prov: "document", store: "pay_rules · overtime", from: "platform-team-rules.md §3 · Engineering handbook §2.1", info: { sub: "Extra hours for the Platform team", lines: ["1.5 × the hourly equivalent in release weeks, only when the engineering lead approved the hours before they were worked."] } }) },
    { id: "c_stipend", fn: ["allow"], n: node({ id: "c_stipend", col: 0, row: 4, group: "Inputs", title: "Home office stipend", tag: "Document", stat: "$150 / mo", text: "Full-time employees", prov: "document", store: "pay_rules · stipend", from: "Benefits policy v2 §3.1", info: { sub: "A fixed monthly amount", lines: ["$150 a month for full-time employees. 5 employees qualify, so $750.00."] } }) },
    { id: "c_leave", fn: ["leave"], n: node({ id: "c_leave", col: 0, row: 5, group: "Inputs", title: "Leave records", tag: "Record", stat: "5 requests", text: "9 days approved", prov: "record", store: "leave_records", from: "Requested by workers, approved by HR", info: { sub: "Approved paid leave", lines: ["Example: LV-0412, Daniel Okafor, Oct 8–9, approved by Maya Reyes on Oct 1."] } }) },
    { id: "c_leaverule", fn: ["leave"], n: node({ id: "c_leaverule", col: 0, row: 6, group: "Inputs", title: "Paid leave rule", tag: "Document", stat: "20–25 d", text: "Per year, by agreement", prov: "document", store: "pay_rules · leave", from: "Benefits §2 · Agreements §5.1", info: { sub: "Entitlement per year", lines: ["The company default is 20 days. Individual agreements can replace it, for example 25 days for Daniel Okafor."] } }) },
    { id: "c_tax", fn: ["tax"], n: node({ id: "c_tax", col: 0, row: 7, group: "Inputs", title: "Payroll tax rate", tag: "Document", stat: "7.65%", text: "Paid by the company", prov: "document", store: "pay_rules · employer_tax", from: "Benefits policy v2 §4.1", info: { sub: "Employer payroll tax", lines: ["7.65% of base pay for employees. Contractors have none."] } }) },
  ];
  const rowOf = (id: string) => pts.find((p) => p.id === id)!.n.row;
  const mean = (ids: string[]) => ids.reduce((a, i) => a + rowOf(i), 0) / ids.length;
  const fnIn: Record<string, string[]> = { base: ["c_hours", "c_rates", "c_salary"], ot: ["c_hours", "c_ot"], allow: ["c_rates", "c_stipend"], leave: ["c_leave", "c_leaverule"], tax: ["c_tax"] };
  const fnRows: Record<string, number> = { base: mean(fnIn.base), ot: 2.3, allow: 3.6, leave: mean(fnIn.leave), tax: 7 };
  const stack = stackNodes(4, 2.4, 3.9, 5.4, total, "Run total");
  return {
    nodes: [...pts.map((p) => p.n), ...fns.map((n) => ({ ...n, col: 1, row: fnRows[n.id] })), { ...result, col: 2, row: 3.6 }, ...stack.map((n) => ({ ...n, col: 3 }))],
    edges: [...Object.entries(fnIn).flatMap(([fn, ins]) => ins.map((i) => [i, fn] as [string, string])), ["base", "result"], ["ot", "result"], ["allow", "result"], ["leave", "result"], ["tax", "audit"], ["result", "review"], ...stackEdges],
  };
}

/* ------------------------------------------------------------------------------------------------ person */

const employeeCodes = new Set(["W001", "W002", "W005", "W008", "W012"]);
const hourlyPlan: Record<string, { hours: number; rate: number; cap?: number }> = {
  W004: { hours: 0, rate: KENJI_RATE, cap: 140 }, W006: { hours: 84, rate: 40 }, W009: { hours: 64, rate: 38 }, W011: { hours: 88, rate: 40 }, W014: { hours: 120, rate: 65 },
};

export type Check = { label: string; ok: boolean; why: string };
export type PersonStatus = "matched" | "review" | "hold";
export type PersonInfo = { id: string; name: string; job: string; kind: string; status: PersonStatus; checks: Check[]; reason: string };

const workerOf = (code: string) => workers.find((w) => w.code === code)!;
const hoursOf = (code: string, monthIdx: number) => (code === "W004" ? months[monthIdx].kenjiHours : hourlyPlan[code].hours);
const payKind = (code: string): "employee" | "hourly" | "retainer" => (employeeCodes.has(code) ? "employee" : hourlyPlan[code] ? "hourly" : "retainer");

/** What a person is: how they are paid, whether their workflow is in order, and the checks behind that. */
export function personInfo(code: string, monthIdx: number): PersonInfo {
  const w = workerOf(code);
  const status = (monthRows(monthIdx).find((x) => x.code === code)?.check ?? "matched") as PersonStatus;
  const kind = payKind(code);
  const hrs = kind === "hourly" ? hoursOf(code, monthIdx) : 0;
  const cap = hourlyPlan[code]?.cap;
  const checks: Check[] =
    kind === "employee"
      ? [
          { label: "Salary matches the employment agreement", ok: true, why: `${w.monthly} a month, ${w.annual} a year` },
          { label: "Hours are accounted for", ok: true, why: "Scheduled hours are covered by work and approved leave" },
          { label: "Leave is within the entitlement", ok: true, why: "Balance is above zero" },
          { label: "Deductions run in the configured order", ok: true, why: "Pension, income tax, social security, Medicare" },
          { label: "Pay rules from policy v3 applied", ok: true, why: "Approved by Maya Reyes on Sep 28" },
        ]
      : kind === "hourly"
        ? [
            { label: "Hours match the timesheet", ok: true, why: `${hrs} h in the import, matched to ${code}` },
            { label: "Hours are within the contract cap", ok: !(cap && hrs > cap), why: cap ? (hrs > cap ? `${hrs} h in the timesheet, the contract caps at ${cap} h` : `${hrs} h, cap ${cap} h`) : "No monthly cap in the agreement" },
            { label: "Rate matches the agreement", ok: true, why: `${usd(hourlyPlan[code].rate)} an hour` },
            { label: "Payout wallet is unchanged", ok: status !== "hold", why: status === "hold" ? "Wallet changed on Oct 6 (now ends e07D). A second person must confirm the new recipient" : "Same wallet as the last payment" },
            { label: "Pay rules from policy v3 applied", ok: true, why: "Approved by Maya Reyes on Sep 28" },
          ]
        : [
            { label: "Retainer matches the agreement", ok: true, why: `${w.monthly} a month, fixed` },
            { label: "No duplicate invoice or timesheet", ok: true, why: "One record for this period" },
            { label: "Payout wallet is unchanged", ok: true, why: "Same wallet as the last payment" },
            { label: "Pay rules from policy v3 applied", ok: true, why: "Approved by Maya Reyes on Sep 28" },
          ];
  const failed = checks.filter((c) => !c.ok);
  const reason = failed.length
    ? `${failed.length} of ${checks.length} checks failed: ${failed.map((c) => c.why).join("; ")}. A person has to decide before this reaches pay.`
    : `All ${checks.length} checks passed: ${checks.map((c) => c.label.toLowerCase()).join(", ")}.`;
  const label = kind === "employee" ? "Employee · salaried" : kind === "hourly" ? "Contractor · hourly" : "Contractor · retainer";
  return { id: code, name: w.name, job: w.job[1], kind: label, status, checks, reason };
}

/** The card that produces a worker's monthly pay in their detailed workflow. */
export function monthlyPayCard(code: string): string {
  return code === "W008" ? "s4" : payKind(code) === "employee" ? "e1" : payKind(code) === "hourly" ? "gross" : "ret";
}

export function peopleList(monthIdx: number): PersonInfo[] {
  return workers.map((w) => personInfo(w.code, monthIdx));
}

export function personGraph(detail: Detail, who: PersonId, monthIdx: number): Graph {
  if (who === "W008") return daniel(detail);
  return payKind(who) === "employee" ? employee(detail, who, monthIdx) : contractor(detail, who, monthIdx);
}

function daniel(detail: Detail): Graph {
  const t = danielTrace();
  const net = usd(t.net);
  const stack = (col: number, a: number, b: number, c: number) => stackNodes(col, a, b, c, net, "Daniel Okafor, net pay");
  const recon = node({ id: "recon", col: 1, row: 0, group: "Checks", title: "Reconcile W008", tag: "Step 1", stat: "Matched", text: "176 h accounted for, nothing unexplained", store: "reconciliation results", from: "oct-2026.csv row 22 and leave record LV-0412",
    info: { sub: "Do his hours add up?", calc: [{ k: "Worked", v: "160 h", src: ["d_csv"] }, { k: "Paid leave", v: "16 h", src: ["d_leave"] }, { k: "Scheduled", v: "176 h", src: ["d_holiday"] }], note: "Matches the schedule. 6 extra hours are approved separately (release week)." } });

  // detailed documents and imports (the leaves of the graph)
  const docs: GNode[] = [
    node({ id: "d_holiday", col: 0, row: 0, group: "Documents and data", title: "Holiday calendar 2026", tag: "Document", stat: "line 11", text: "No October holidays", prov: "document", store: "Policy library · Holiday calendar 2026.txt", from: "Company level · Benefits policy v2 §1.3", info: { sub: "Which days are working days", lines: ["Line 11: no holidays in October, so 22 working days at 8 hours."] } }),
    node({ id: "d_benefits", col: 0, row: 1, group: "Documents and data", title: "Benefits policy v2", tag: "Document", stat: "§1.2 · §3.1 · §4.1", text: "Salary ÷ 12 · stipend · employer tax", prov: "document", store: "Policy library · Benefits policy v2.docx", from: "Company level, approved in pay policy v3", info: { sub: "Applies to everyone", lines: ["§1.2 one twelfth of annual salary. §3.1 $150 home office stipend for full-time employees. §4.1 employer payroll tax 7.65%. §6.2 pension match 4%."] } }),
    node({ id: "d_leave", col: 0, row: 2, group: "Documents and data", title: "Leave record LV-0412", tag: "Record", stat: "2 days", text: "Oct 8–9, balance 18 → 16", prov: "record", store: "leave_records · LV-0412", from: "Approved by Maya Reyes on Oct 1", info: { sub: "Paid leave taken", lines: ["Oct 8–9, 2 days (16 h). Paid leave counts as worked time, so pay does not change."] } }),
    node({ id: "d_agree", col: 0, row: 3, group: "Documents and data", title: "Employment agreement", tag: "Document", stat: "$78,000 / yr", text: "§3.1 salary · §5.1 25 days · §6.1 pension 5%", prov: "document", store: "Policy library · Employment agreement, D. Okafor.pdf", from: "Individual level · signed Feb 20, 2025", info: { sub: "Replaces company defaults for Daniel", lines: ["Salary $78,000 a year. 25 days of paid leave (replaces the company's 20). Pension 5% of wages (replaces the 3% default)."] } }),
    node({ id: "d_csv", col: 0, row: 4, group: "Documents and data", title: "oct-2026.csv", tag: "Import", stat: "row 22", text: "6 h release week Oct 19–23", prov: "import", store: "Timesheet import · row 22 (shown as W008)", from: "Uploaded Oct 7 · hours approved by Marcus Bell on Oct 16", info: { sub: "What he worked", lines: ["160 regular hours and 6 hours in the release week of Oct 19–23."] } }),
    node({ id: "d_platform", col: 0, row: 5, group: "Documents and data", title: "platform-team-rules.md", tag: "Document", stat: "§3", text: "1.5 × hourly equivalent", prov: "document", store: "Policy library · platform-team-rules.md", from: "Subgroup level · Platform team", info: { sub: "Overtime for salaried Platform staff", lines: ["Release-week hours are paid at 1.5 × the hourly equivalent."] } }),
    node({ id: "d_handbook", col: 0, row: 6, group: "Documents and data", title: "Engineering handbook", tag: "Document", stat: "§2.1 · §4.2", text: "Lead approves overtime · $100 learning", prov: "document", store: "Policy library · Engineering handbook.docx", from: "Group level · Engineering", info: { sub: "Rules for the Engineering group", lines: ["§2.1 the engineering lead approves overtime before it is worked. §4.2 up to $100 a month for learning, with a receipt."] } }),
    node({ id: "d_deduct", col: 0, row: 7, group: "Documents and data", title: "Payroll deductions 2026", tag: "Document", stat: "rows 2–6", text: "Pension, tax, social security, Medicare", prov: "document", store: "Policy library · Payroll deductions 2026.xlsx", from: "Company level · rates and order", info: { sub: "What is withheld, and in which order", lines: ["Pension first, then income tax (12%), social security (6.2%) and Medicare (1.45%)."] } }),
    node({ id: "d_receipt", col: 0, row: 8, group: "Documents and data", title: "Course receipt", tag: "Record", stat: "$79.00", text: "Uploaded Oct 12", prov: "record", store: "reimbursements · receipt R-221", from: "Uploaded by Daniel · under the $100 limit", info: { sub: "A reimbursement, not wages", lines: ["A course receipt under the monthly learning budget."] } }),
  ];
  const step = (id: string, col: number, row: number, group: string, title: string, no: number, stat: string, text: string, calc: Row[], extra: Partial<Seed> = {}) =>
    node({ id, col, row, group, title, tag: `Step ${no}`, stat, text, info: { sub: text, calc }, ...extra });
  const steps: GNode[] = [
    step("s1", 1, 1, "Time", "Scheduled hours", 1, "176 h", "22 working days × 8 h", [{ k: "Working days", v: "22", src: ["d_holiday"] }, { k: "Hours a day", v: "8", src: ["d_benefits"] }], { total: undefined, from: "Holiday calendar · Benefits §1.3" } as Partial<Seed>),
    step("s2", 1, 2.6, "Time", "Paid leave taken", 2, "16 h", "No pay change · balance 18 → 16 days", [{ k: "Oct 8–9", v: "2 days", src: ["d_leave"] }, { k: "Entitlement", v: "25 days a year", src: ["d_agree"] }], { prov: "record", from: "LV-0412 · Employment agreement §5.1" }),
    step("s3", 1, 4.2, "Time", "Hours accounted for", 3, "176 h + 6 h", "Worked 160 + leave 16, plus overtime", [{ k: "Worked", v: "160 h", src: ["d_csv"] }, { k: "Paid leave", v: "16 h", src: ["s2"] }, { k: "Scheduled", v: "176 h", src: ["s1"] }, { k: "Overtime hours", v: "6 h", src: ["d_csv"] }]),
    step("s4", 2, 0, "Earnings", "Base salary", 4, usd(t.base), "$78,000 ÷ 12", [{ k: "Annual salary", v: "$78,000.00", src: ["d_agree"] }, { k: "÷ 12 months", v: "", src: ["d_benefits"] }], { total: { k: "Base salary", v: usd(t.base) }, from: "Employment agreement §3.1 · Benefits §1.2" } as Partial<Seed>),
    step("s5", 2, 1.4, "Earnings", "Hourly equivalent", 5, "$36.93…", "Base ÷ 176 h, unrounded", [{ k: "Base salary", v: usd(t.base), src: ["s4"] }, { k: "Scheduled hours", v: "176 h", src: ["s1"] }], { from: "Kept unrounded, used only in step 6" }),
    step("s6", 2, 2.8, "Earnings", "Release-week overtime", 6, usd(t.ot), "6 h × equivalent × 1.5", [{ k: "Overtime hours", v: "6 h", src: ["s3"] }, { k: "Hourly equivalent", v: "$36.93…", src: ["s5"] }, { k: "Multiplier", v: "1.5", src: ["d_platform"] }], { from: "platform-team-rules §3 · Engineering handbook §2.1" }),
    step("s7", 2, 4.2, "Earnings", "Home office stipend", 7, usd(t.stipend), "Flat monthly amount", [{ k: "Stipend", v: "$150.00", src: ["d_benefits"] }], { prov: "document", from: "Benefits policy §3.1" }),
    step("s8", 2, 5.6, "Earnings", "Wages", 8, usd(t.wages), "Base + overtime + stipend", [{ k: "Base salary", v: usd(t.base), src: ["s4"] }, { k: "Overtime", v: usd(t.ot), src: ["s6"] }, { k: "Stipend", v: usd(t.stipend), src: ["s7"] }], { total: { k: "Wages", v: usd(t.wages) }, from: "Wages exclude reimbursements (Deductions xlsx row 2)" } as Partial<Seed>),
    step("s9", 3, 0, "Gross pay", "Learning reimbursement", 9, usd(t.reimb), "Receipt under the $100 limit", [{ k: "Receipt Oct 12", v: "$79.00", src: ["d_receipt"] }, { k: "Monthly limit", v: "$100.00", src: ["d_handbook"] }], { note: "Not part of wages." } as Partial<Seed>),
    step("s10", 3, 1.2, "Gross pay", "Gross pay", 10, usd(t.gross), "Wages + reimbursement", [{ k: "Wages", v: usd(t.wages), src: ["s8"] }, { k: "Reimbursement", v: usd(t.reimb), src: ["s9"] }], { total: { k: "Gross pay", v: usd(t.gross) } } as Partial<Seed>),
    step("s11", 3, 2.6, "Deductions", "Pension, worker share", 11, "−" + usd(t.pension), "Wages × 5%", [{ k: "Wages", v: usd(t.wages), src: ["s8"] }, { k: "Rate", v: "5%", src: ["d_agree"] }, { k: "Order", v: "Comes first", src: ["d_deduct"] }]),
    step("s12", 3, 3.8, "Deductions", "Income tax withholding", 12, "−" + usd(t.tax), "(Wages − pension) × 12%", [{ k: "Wages − pension", v: usd(r2(t.wages - t.pension)), src: ["s8", "s11"] }, { k: "Rate", v: "12%", src: ["d_deduct"] }]),
    step("s13", 3, 5, "Deductions", "Social security", 13, "−" + usd(t.ss), "Wages × 6.2%", [{ k: "Wages", v: usd(t.wages), src: ["s8"] }, { k: "Rate", v: "6.2%", src: ["d_deduct"] }]),
    step("s14", 3, 6.2, "Deductions", "Medicare", 14, "−" + usd(t.medicare), "Wages × 1.45%", [{ k: "Wages", v: usd(t.wages), src: ["s8"] }, { k: "Rate", v: "1.45%", src: ["d_deduct"] }]),
    step("s15", 3, 7.4, "Deductions", "Total deductions", 15, "−" + usd(t.deductions), "Sum of steps 11 to 14", [{ k: "Pension", v: usd(t.pension), src: ["s11"] }, { k: "Income tax", v: usd(t.tax), src: ["s12"] }, { k: "Social security", v: usd(t.ss), src: ["s13"] }, { k: "Medicare", v: usd(t.medicare), src: ["s14"] }], { total: { k: "Total deductions", v: usd(t.deductions) } } as Partial<Seed>),
    step("s16", 4, 2.6, "Result", "Net pay", 16, net, "Gross pay − deductions", [{ k: "Gross pay", v: usd(t.gross), src: ["s10"] }, { k: "Deductions", v: usd(t.deductions), src: ["s15"] }], { total: { k: "Net pay", v: net }, from: "Goes into the payment plan for Oct 30" } as Partial<Seed>),
    step("s17", 4, 5.2, "Employer cost", "Employer payroll tax", 17, usd(t.erTax), "Wages × 7.65%", [{ k: "Wages", v: usd(t.wages), src: ["s8"] }, { k: "Rate", v: "7.65%", src: ["d_benefits"] }], { note: "Paid by Northwind on top. Not taken from pay." } as Partial<Seed>),
    step("s18", 4, 6.6, "Employer cost", "Pension match", 18, usd(t.match), "Wages × 4%", [{ k: "Wages", v: usd(t.wages), src: ["s8"] }, { k: "Rate", v: "4%", src: ["d_benefits"] }], { note: "Benefits §6.2. Paid by Northwind on top." } as Partial<Seed>),
  ];
  const detailedEdges: [string, string][] = [["d_holiday", "s1"], ["d_benefits", "s1"], ["d_leave", "s2"], ["d_agree", "s2"], ["s1", "s3"], ["s2", "s3"], ["d_csv", "s3"], ["d_agree", "s4"], ["d_benefits", "s4"], ["s4", "s5"], ["s1", "s5"], ["s5", "s6"], ["s3", "s6"], ["d_platform", "s6"], ["d_handbook", "s6"], ["d_benefits", "s7"],
    ["s4", "s8"], ["s6", "s8"], ["s7", "s8"], ["d_receipt", "s9"], ["d_handbook", "s9"], ["s8", "s10"], ["s9", "s10"], ["s8", "s11"], ["d_agree", "s11"], ["d_deduct", "s11"], ["s8", "s12"], ["s11", "s12"], ["d_deduct", "s12"], ["s8", "s13"], ["d_deduct", "s13"], ["s8", "s14"], ["d_deduct", "s14"],
    ["s11", "s15"], ["s12", "s15"], ["s13", "s15"], ["s14", "s15"], ["s10", "s16"], ["s15", "s16"], ["s8", "s17"], ["d_benefits", "s17"], ["s8", "s18"], ["d_benefits", "s18"], ["s16", "review"], ["s17", "audit"], ["s18", "audit"]];

  if (detail === "detailed") {
    return { nodes: [...docs, ...steps, ...stack(5, 2.4, 3.9, 5.4)], edges: [...detailedEdges, ...stackEdges] };
  }

  if (detail === "complex") {
    const src = (id: string, row: number, title: string, stat: string, text: string, prov: Prov, store: string, from: string, lines: string[]) =>
      node({ id, col: 0, row, group: "Documents and data", title, tag: prov === "document" ? "Policy level" : "Source", stat, text, prov, store, from, info: { sub: text, lines } });
    const t8 = t;
    return {
      nodes: [
        src("pol_company", 0, "Company policies", "3 files", "Benefits v2 · Deductions · Holidays", "document", "Policy library · company level", "Applies to everyone", ["Benefits policy v2, Payroll deductions 2026 and the Holiday calendar."]),
        src("pol_group", 1.2, "Group · Engineering", "1 file", "Engineering handbook", "document", "Policy library · group level", "Department on his worker record", ["Overtime needs the lead's approval; learning budget up to $100 a month."]),
        src("pol_sub", 2.4, "Subgroup · Platform", "1 file", "platform-team-rules.md", "document", "Policy library · subgroup level", "Team on his record since Jan 5, 2026", ["Release-week hours are paid at 1.5 × the hourly equivalent."]),
        src("pol_ind", 3.6, "Individual · Daniel", "1 file", "Employment agreement", "document", "Policy library · individual level", "Signed Feb 20, 2025", ["Salary $78,000 a year, 25 days of leave, pension 5%. Replaces company defaults."]),
        src("csv", 4.8, "oct-2026.csv", "row 22", "6 h release week", "import", "Timesheet import · row 22", "Uploaded Oct 7 · hours approved Oct 16", ["160 regular hours and 6 release-week hours."]),
        src("leave", 6, "Leave LV-0412", "2 days", "Oct 8–9, approved Oct 1", "record", "leave_records · LV-0412", "Approved by Maya Reyes", ["2 days (16 h) of paid leave. Balance 18 → 16 days."]),
        { ...recon, id: "recon", col: 1, row: 5.4 },
        node({ id: "wins", col: 1, row: 1.8, group: "Checks", title: "Which rule wins", tag: "Step 1", stat: "Most specific", text: "Individual, subgroup, group, company", prov: "document", store: "pay_rules (versioned)", from: "Pay policy v3, approved Sep 28 by Maya Reyes",
          info: { sub: "Four levels, one winner per setting", lines: ["The most specific level wins: individual, then subgroup, then group, then company, unless HR approved a different order. Two rules at the same level that disagree stop the run until HR decides.", "AI search may show similar text from other files. It is shown for checking only and never applies a rule."] } }),
        node({ id: "time", col: 2, row: 5.4, group: "Calculations", title: "Time", tag: "Steps 1–3", stat: "176 h", text: "Scheduled, leave, hours accounted", info: { sub: "Do the hours add up?", calc: [{ k: "Scheduled", v: "176 h", src: ["wins"] }, { k: "Paid leave", v: "16 h", src: ["leave"] }, { k: "Overtime", v: "6 h", src: ["csv"] }], note: "Worked 160 + leave 16 = 176 h. Nothing unexplained." } }),
        node({ id: "earn", col: 2, row: 2.8, group: "Calculations", title: "Earnings", tag: "Steps 4–8", stat: usd(t8.wages), text: "Base + overtime + stipend", info: { sub: "Wages", calc: [{ k: "Base salary ($78,000 ÷ 12)", v: usd(t8.base), src: ["pol_ind"] }, { k: "Release-week overtime", v: usd(t8.ot), src: ["pol_sub"] }, { k: "Home office stipend", v: usd(t8.stipend), src: ["pol_company"] }], total: { k: "Wages", v: usd(t8.wages) } } }),
        node({ id: "reimb", col: 2, row: 0.6, group: "Calculations", title: "Reimbursement", tag: "Step 9", stat: usd(t8.reimb), text: "Course receipt, not wages", info: { sub: "Learning budget", calc: [{ k: "Receipt Oct 12", v: "$79.00", src: ["pol_group"] }, { k: "Limit", v: "$100.00 a month", src: ["pol_group"] }] } }),
        node({ id: "ded", col: 3, row: 4, group: "Calculations", title: "Deductions", tag: "Steps 11–15", stat: "−" + usd(t8.deductions), text: "Pension, tax, social security, Medicare", info: { sub: "In the order set by the deductions file", calc: [{ k: "Pension 5%", v: "−" + usd(t8.pension), src: ["pol_ind"] }, { k: "Income tax 12%", v: "−" + usd(t8.tax), src: ["pol_company"] }, { k: "Social security 6.2%", v: "−" + usd(t8.ss), src: ["pol_company"] }, { k: "Medicare 1.45%", v: "−" + usd(t8.medicare), src: ["pol_company"] }], total: { k: "Total deductions", v: "−" + usd(t8.deductions) } } }),
        node({ id: "gross", col: 3, row: 1.2, group: "Calculations", title: "Gross pay", tag: "Step 10", stat: usd(t8.gross), text: "Wages + reimbursement", info: { sub: "Before deductions", calc: [{ k: "Wages", v: usd(t8.wages), src: ["earn"] }, { k: "Reimbursement", v: usd(t8.reimb), src: ["reimb"] }], total: { k: "Gross pay", v: usd(t8.gross) } } }),
        node({ id: "net", col: 4, row: 2.6, group: "Result", title: "Net pay", tag: "Step 16", stat: net, text: "Gross − deductions", info: { sub: "What goes into the payment plan", calc: [{ k: "Gross pay", v: usd(t8.gross), src: ["gross"] }, { k: "Deductions", v: "−" + usd(t8.deductions), src: ["ded"] }], total: { k: "Net pay", v: net } } }),
        node({ id: "emp", col: 4, row: 5.4, group: "Employer cost", title: "Employer costs", tag: "Steps 17–18", stat: usd(r2(t8.erTax + t8.match)), text: "Payroll tax + pension match", info: { sub: "Paid by the company on top of pay", calc: [{ k: "Payroll tax 7.65%", v: usd(t8.erTax), src: ["pol_company"] }, { k: "Pension match 4%", v: usd(t8.match), src: ["pol_company"] }], note: "Not taken from Daniel's pay." } }),
        ...stack(5, 1.4, 2.9, 4.4).map((n) => ({ ...n, col: 5 })),
      ],
      edges: [["pol_company", "wins"], ["pol_group", "wins"], ["pol_sub", "wins"], ["pol_ind", "wins"], ["csv", "recon"], ["leave", "recon"], ["recon", "time"], ["wins", "time"], ["wins", "earn"], ["wins", "reimb"], ["time", "earn"], ["earn", "gross"], ["reimb", "gross"], ["earn", "ded"], ["wins", "ded"], ["gross", "net"], ["ded", "net"], ["earn", "emp"], ["net", "review"], ["emp", "audit"], ...stackEdges],
    };
  }

  // simple
  return {
    nodes: [
      node({ id: "inputs", col: 0, row: 1, group: "Inputs", title: "His inputs", tag: "Source", stat: "6 sources", text: "Four policy levels, timesheet, leave", prov: "document", store: "Policy library, timesheet import, leave records", from: "Provided by Northwind Remote", info: { sub: "Everything comes from documents and records", lines: ["Company, group, subgroup and individual policies, the October timesheet and one leave record. Switch to Complex or Detailed to see each one."] } }),
      { ...recon, col: 1, row: 1 },
      node({ id: "calc", col: 2, row: 1, group: "Calculation", title: "Calculate", tag: "Steps 1–18", stat: net, text: `Wages ${usd(t.wages)} → net pay`, info: { sub: "Eighteen steps, in a fixed order", calc: [{ k: "Wages", v: usd(t.wages) }, { k: "Gross pay", v: usd(t.gross) }, { k: "Deductions", v: "−" + usd(t.deductions) }], total: { k: "Net pay", v: net } } }),
      ...stack(3, 1, 0.5, 1.5).map((n) => (n.id === "pay" ? { ...n, col: 4, row: 0.5 } : n.id === "audit" ? { ...n, col: 4, row: 1.5 } : n)),
    ],
    edges: [["inputs", "recon"], ["recon", "calc"], ["calc", "review"], ...stackEdges],
  };
}

const reconFor = (code: string, monthIdx: number, col: number, row: number): GNode => {
  const p = personInfo(code, monthIdx);
  const bad = p.checks.filter((c) => !c.ok);
  return node({
    id: "recon", col, row, group: "Checks", title: `Reconcile ${code}`, tag: "Step 1",
    stat: p.status === "matched" ? "Matched" : p.status === "review" ? "Needs review" : "On hold",
    text: bad.length ? bad[0].why : `All ${p.checks.length} checks passed`,
    tone: bad.length ? "warn" : "ok", prov: "code", store: "reconciliation results", from: `Timesheet import and the records for ${code}, compared with the agreement`,
    info: { sub: bad.length ? "Why this workflow is not clear to pay" : "Why this workflow is working correctly", lines: p.checks.map((c) => `${c.ok ? "Passed" : "Failed"} · ${c.label}. ${c.why}.`), note: bad.length ? p.reason : undefined },
  });
};

/** The approval cards, but blocked when the checks did not pass (nothing is signed until a person decides). */
const stackFor = (code: string, monthIdx: number, col: number, rows: [number, number, number], net: string): GNode[] => {
  const p = personInfo(code, monthIdx);
  const s = stackNodes(col, rows[0], rows[1], rows[2], net, `${p.name}, payable`);
  if (p.status === "matched") return s;
  const why = p.checks.filter((c) => !c.ok).map((c) => c.why).join("; ");
  return s.map((n) => (n.id === "review"
    ? { ...n, stat: "Not signed", text: "Waiting for the check above", tone: "warn" as Tone, info: { sub: "Blocked until a person decides", lines: [`${why}.`], note: "Nothing is signed, and nothing can be paid, until the failed check is resolved." } }
    : n));
};

function employee(detail: Detail, code: string, monthIdx: number): Graph {
  const w = workerOf(code);
  const initials = w.name.split(" ").map((x) => x[0]).join("");
  const base = parseUsd(w.monthly);
  const stipend = 150;
  const wages = r2(base + stipend);
  const pension = r2(wages * 0.03);
  const tax = r2((wages - pension) * 0.12);
  const ss = r2(wages * 0.062);
  const med = r2(wages * 0.0145);
  const ded = r2(pension + tax + ss + med);
  const net = r2(wages - ded);
  const erTax = r2(wages * 0.0765);
  const match = r2(wages * 0.04);
  const netS = usd(net);
  const recon = (col: number, row: number) => reconFor(code, monthIdx, col, row);
  const stack = (col: number, rows: [number, number, number]) => stackFor(code, monthIdx, col, rows, netS);
  const agree = (col: number, row: number) => node({ id: "d_agree", col, row, group: "Documents and data", title: "Employment agreement", tag: "Document", stat: w.annual.replace(".00", "") + " / yr", text: "§3.1 salary", prov: "document", store: `Policy library · Employment agreement, ${initials}.pdf`, from: `Individual level · started ${w.start}`, info: { sub: "Replaces company defaults", lines: [`Salary ${w.annual} a year, paid in twelve equal months.`] } });
  const benefits = (col: number, row: number) => node({ id: "d_benefits", col, row, group: "Documents and data", title: "Benefits policy v2", tag: "Document", stat: "§1.2 · §3.1", text: "Salary ÷ 12 · $150 stipend", prov: "document", store: "Policy library · Benefits policy v2.docx", from: "Company level, approved in pay policy v3", info: { sub: "Applies to everyone", lines: ["§1.2 one twelfth of annual salary. §3.1 $150 home office stipend for full-time employees. §4.1 employer payroll tax 7.65%. §6.2 pension match 4%."] } });
  const deduct = (col: number, row: number) => node({ id: "d_deduct", col, row, group: "Documents and data", title: "Payroll deductions 2026", tag: "Document", stat: "rows 2–6", text: "Pension, tax, social security, Medicare", prov: "document", store: "Policy library · Payroll deductions 2026.xlsx", from: "Company level · rates and order", info: { sub: "What is withheld, and in which order", lines: ["Pension (3% default), then income tax 12%, social security 6.2% and Medicare 1.45%."] } });

  if (detail === "detailed") {
    const st = (id: string, col: number, row: number, group: string, title: string, no: number, stat: string, text: string, calc: Row[], extra: Partial<Seed> = {}) => node({ id, col, row, group, title, tag: `Step ${no + 1}`, stat, text, info: { sub: text, calc, ...(extra.info ?? {}) }, ...(extra.from ? { from: extra.from } : {}) });
    return {
      nodes: [
        agree(0, 0), benefits(0, 1.4), deduct(0, 2.8), recon(1, 3),
        st("e1", 1, 0, "Earnings", "Base salary", 1, usd(base), `${w.annual} ÷ 12`, [{ k: "Annual salary", v: w.annual, src: ["d_agree"] }, { k: "÷ 12 months", v: "", src: ["d_benefits"] }]),
        st("e2", 1, 1.5, "Earnings", "Home office stipend", 2, usd(stipend), "Flat monthly amount", [{ k: "Stipend", v: "$150.00", src: ["d_benefits"] }]),
        st("e3", 2, 0.8, "Earnings", "Wages", 3, usd(wages), "Base + stipend", [{ k: "Base salary", v: usd(base), src: ["e1"] }, { k: "Stipend", v: usd(stipend), src: ["e2"] }], { info: { sub: "Base + stipend", total: { k: "Wages", v: usd(wages) } } }),
        st("e4", 3, 0, "Deductions", "Pension, worker share", 4, "−" + usd(pension), "Wages × 3% (default)", [{ k: "Wages", v: usd(wages), src: ["e3"] }, { k: "Rate", v: "3%", src: ["d_deduct"] }]),
        st("e5", 3, 1.2, "Deductions", "Income tax withholding", 5, "−" + usd(tax), "(Wages − pension) × 12%", [{ k: "Wages − pension", v: usd(r2(wages - pension)), src: ["e3", "e4"] }, { k: "Rate", v: "12%", src: ["d_deduct"] }]),
        st("e6", 3, 2.4, "Deductions", "Social security", 6, "−" + usd(ss), "Wages × 6.2%", [{ k: "Wages", v: usd(wages), src: ["e3"] }, { k: "Rate", v: "6.2%", src: ["d_deduct"] }]),
        st("e7", 3, 3.6, "Deductions", "Medicare", 7, "−" + usd(med), "Wages × 1.45%", [{ k: "Wages", v: usd(wages), src: ["e3"] }, { k: "Rate", v: "1.45%", src: ["d_deduct"] }]),
        st("e8", 4, 0.4, "Deductions", "Total deductions", 8, "−" + usd(ded), "Sum of steps 4 to 7", [{ k: "Pension", v: usd(pension), src: ["e4"] }, { k: "Income tax", v: usd(tax), src: ["e5"] }, { k: "Social security", v: usd(ss), src: ["e6"] }, { k: "Medicare", v: usd(med), src: ["e7"] }], { info: { sub: "Sum of steps 4 to 7", total: { k: "Total deductions", v: usd(ded) } } }),
        st("e9", 4, 1.9, "Result", "Net pay", 9, netS, "Wages − deductions", [{ k: "Wages", v: usd(wages), src: ["e3"] }, { k: "Deductions", v: usd(ded), src: ["e8"] }], { info: { sub: "What goes into the payment plan", total: { k: "Net pay", v: netS } } }),
        st("e10", 4, 3.4, "Employer cost", "Employer costs", 10, usd(r2(erTax + match)), "Payroll tax 7.65% + pension match 4%", [{ k: "Payroll tax 7.65%", v: usd(erTax), src: ["e3"] }, { k: "Pension match 4%", v: usd(match), src: ["e3"] }], { info: { sub: "Paid by the company on top of pay", note: "Not taken from pay." } }),
        ...stack(5, [0.8, 2.3, 3.8]),
      ],
      edges: [["d_agree", "e1"], ["d_benefits", "e2"], ["d_agree", "recon"], ["e1", "e3"], ["e2", "e3"], ["recon", "e3"], ["e3", "e4"], ["d_deduct", "e4"], ["e3", "e5"], ["e4", "e5"], ["d_deduct", "e5"], ["e3", "e6"], ["d_deduct", "e6"], ["e3", "e7"], ["d_deduct", "e7"], ["e4", "e8"], ["e5", "e8"], ["e6", "e8"], ["e7", "e8"], ["e3", "e9"], ["e8", "e9"], ["e3", "e10"], ["d_benefits", "e10"], ["e9", "review"], ["e10", "audit"], ...stackEdges],
    };
  }
  if (detail === "complex") {
    return {
      nodes: [
        agree(0, 0.3), benefits(0, 1.7), deduct(0, 3.1), recon(1, 0.3),
        node({ id: "wages", col: 2, row: 1.2, group: "Calculations", title: "Wages", tag: "Steps 1–3", stat: usd(wages), text: "Base salary + stipend", info: { sub: "What is earned this month", calc: [{ k: `Base salary (${w.annual} ÷ 12)`, v: usd(base), src: ["d_agree"] }, { k: "Home office stipend", v: usd(stipend), src: ["d_benefits"] }], total: { k: "Wages", v: usd(wages) } } }),
        node({ id: "ded", col: 3, row: 0.4, group: "Calculations", title: "Deductions", tag: "Steps 4–8", stat: "−" + usd(ded), text: "Pension, tax, social security, Medicare", info: { sub: "In the order set by the deductions file", calc: [{ k: "Pension 3%", v: "−" + usd(pension), src: ["d_deduct"] }, { k: "Income tax 12%", v: "−" + usd(tax), src: ["d_deduct"] }, { k: "Social security 6.2%", v: "−" + usd(ss), src: ["d_deduct"] }, { k: "Medicare 1.45%", v: "−" + usd(med), src: ["d_deduct"] }], total: { k: "Total deductions", v: "−" + usd(ded) } } }),
        node({ id: "net", col: 3, row: 2, group: "Result", title: "Net pay", tag: "Step 9", stat: netS, text: "Wages − deductions", info: { sub: "What goes into the payment plan", calc: [{ k: "Wages", v: usd(wages), src: ["wages"] }, { k: "Deductions", v: "−" + usd(ded), src: ["ded"] }], total: { k: "Net pay", v: netS } } }),
        node({ id: "emp", col: 3, row: 3.6, group: "Employer cost", title: "Employer costs", tag: "Step 10", stat: usd(r2(erTax + match)), text: "Payroll tax + pension match", info: { sub: "Paid by the company on top of pay", calc: [{ k: "Payroll tax 7.65%", v: usd(erTax), src: ["d_benefits"] }, { k: "Pension match 4%", v: usd(match), src: ["d_benefits"] }] } }),
        ...stack(4, [1, 2.5, 4]),
      ],
      edges: [["d_agree", "recon"], ["recon", "wages"], ["d_agree", "wages"], ["d_benefits", "wages"], ["wages", "ded"], ["d_deduct", "ded"], ["wages", "net"], ["ded", "net"], ["wages", "emp"], ["d_benefits", "emp"], ["net", "review"], ["emp", "audit"], ...stackEdges],
    };
  }
  return {
    nodes: [
      node({ id: "inputs", col: 0, row: 1, group: "Inputs", title: "Their inputs", tag: "Source", stat: "3 sources", text: "Agreement, benefits, deductions", prov: "document", store: "Policy library", from: "Provided by Northwind Remote", info: { sub: "Everything comes from documents and records", lines: ["The employment agreement, the Benefits policy and the deductions file."] } }),
      recon(1, 1),
      node({ id: "calc", col: 2, row: 1, group: "Calculation", title: "Calculate", tag: "Steps 1–10", stat: netS, text: `Wages ${usd(wages)} → net pay`, info: { sub: "Plain code, fixed order", calc: [{ k: "Wages", v: usd(wages) }, { k: "Deductions", v: "−" + usd(ded) }], total: { k: "Net pay", v: netS } } }),
      ...stack(3, [1, 0.5, 1.5]).map((n) => (n.id === "pay" ? { ...n, col: 4, row: 0.5 } : n.id === "audit" ? { ...n, col: 4, row: 1.5 } : n)),
    ],
    edges: [["inputs", "recon"], ["recon", "calc"], ["calc", "review"], ...stackEdges],
  };
}

function contractor(detail: Detail, code: string, monthIdx: number): Graph {
  const w = workerOf(code);
  const hourly = payKind(code) === "hourly";
  const row = monthRows(monthIdx).find((x) => x.code === code)!;
  const pay = parseUsd(row.monthly);
  const payS = usd(pay);
  const hours = hourly ? hoursOf(code, monthIdx) : 0;
  const rate = hourly ? hourlyPlan[code].rate : 0;
  const cap = hourlyPlan[code]?.cap;
  const initials = w.name.split(" ").map((x) => x[0]).join("");
  const recon = (col: number, r: number) => reconFor(code, monthIdx, col, r);
  const stack = (col: number, rows: [number, number, number]) => stackFor(code, monthIdx, col, rows, payS);
  const csv = (col: number, r: number) => node({ id: "d_csv", col, row: r, group: "Documents and data", title: "Timesheet import", tag: "Import", stat: `${hours} h`, text: `Row for ${code}`, prov: "import", store: `Timesheet import · ${code} (names replaced by worker codes)`, from: "Uploaded by Northwind payroll", info: { sub: "What was worked", lines: [`${hours} hours for the period.`] } });
  const agree = (col: number, r: number) => node({ id: "d_agree", col, row: r, group: "Documents and data", title: "Contractor agreement", tag: "Document", stat: hourly ? `${usd(rate)} / h` : `${w.monthly.replace(".00", "")} / mo`, text: hourly ? (cap ? `Cap ${cap} h a month` : "Hourly rate") : "Fixed monthly retainer", prov: "document", store: `Policy library · Contractor agreement, ${initials}.pdf`, from: `Individual level · started ${w.start}`, info: { sub: hourly ? "Rate" + (cap ? " and monthly cap" : "") : "Retainer", lines: [hourly ? `${usd(rate)} an hour${cap ? `, at most ${cap} hours a month unless a manager approves more` : ""}.` : `${w.monthly} a month, fixed.`] } });
  const hand = (col: number, r: number) => node({ id: "d_hand", col, row: r, group: "Documents and data", title: "Contractor handbook v2", tag: "Document", stat: "§2.6", text: "No withholding for contractors", prov: "document", store: "Policy library · Contractor handbook v2.pdf", from: "Company level · contractors only", info: { sub: "How contractors are paid", lines: ["Contractors are paid the full amount and handle their own taxes. Approved hours above 40 in a week are paid at one and a half times the agreed rate."] } });
  const rec = (col: number, r: number) => node({ id: "d_rec", col, row: r, group: "Documents and data", title: `Worker record ${code}`, tag: "Record", stat: hourly ? "Hourly" : "Retainer", text: "Pay type and payout wallet", prov: "record", store: `workers · ${code}`, from: "Entered by HR", info: { sub: "Pay type and payout wallet", lines: [code === "W014" ? "The payout wallet changed on Oct 6 and now ends e07D." : "Payout wallet unchanged since the last payment."] } });
  const net = (col: number, r: number) => node({ id: "net", col, row: r, group: "Result", title: "Payable", tag: "Final step", stat: payS, text: "No withholding for contractors", info: { sub: "What goes into the payment plan", calc: [{ k: "Pay", v: payS, src: [hourly ? "gross" : "ret"] }, { k: "Withholding", v: "$0.00", src: ["d_hand"] }], total: { k: "Payable", v: payS } } });
  const calc = (col: number, r: number) => node({ id: "calc", col, row: r, group: "Calculations", title: "Calculate", tag: "Steps 2–4", stat: payS, text: hourly ? `${hours} h × ${usd(rate)}` : "Fixed monthly retainer", info: { sub: hourly ? "Hours × rate" : "The agreed retainer", calc: hourly ? [{ k: "Hours", v: `${hours} h`, src: ["d_csv"] }, { k: "Rate", v: usd(rate), src: ["d_agree"] }] : [{ k: "Retainer", v: payS, src: ["d_agree"] }], total: { k: "Pay", v: payS } } });

  if (detail === "detailed") {
    if (!hourly) {
      return {
        nodes: [agree(0, 0), rec(0, 1.4), hand(0, 2.8), recon(1, 1),
          node({ id: "ret", col: 2, row: 1, group: "Calculations", title: "Monthly retainer", tag: "Step 2", stat: payS, text: "Fixed amount from the agreement", info: { sub: "No hours involved", calc: [{ k: "Retainer", v: payS, src: ["d_agree"] }] } }),
          net(3, 1), ...stack(4, [0, 1.5, 3])],
        edges: [["d_agree", "recon"], ["d_rec", "recon"], ["recon", "ret"], ["d_agree", "ret"], ["ret", "net"], ["d_hand", "net"], ["net", "review"], ...stackEdges],
      };
    }
    return {
      nodes: [csv(0, 0), agree(0, 1.4), hand(0, 2.8), rec(0, 4.2), recon(1, 1),
        node({ id: "hours", col: 2, row: 0.6, group: "Calculations", title: "Hours worked", tag: "Step 2", stat: `${hours} h`, text: "From the timesheet", info: { sub: "Hours counted for pay", calc: [{ k: "Timesheet", v: `${hours} h`, src: ["d_csv"] }], note: cap && hours > cap ? `${hours - cap} h over the cap are held for a manager.` : undefined } }),
        node({ id: "rate", col: 2, row: 2, group: "Calculations", title: "Hourly rate", tag: "Step 3", stat: usd(rate), text: "From the agreement", prov: "document", store: `pay_rules · rate (${code})`, from: "Contractor agreement", info: { sub: "Agreed rate", calc: [{ k: "Rate", v: usd(rate), src: ["d_agree"] }] } }),
        node({ id: "gross", col: 2, row: 3.4, group: "Calculations", title: "Pay for the period", tag: "Step 4", stat: payS, text: `${hours} h × ${usd(rate)}`, info: { sub: "Hours × rate", calc: [{ k: "Hours", v: `${hours} h`, src: ["hours"] }, { k: "Rate", v: usd(rate), src: ["rate"] }], total: { k: "Pay", v: payS } } }),
        net(3, 2), ...stack(4, [1, 2.5, 4])],
      edges: [["d_csv", "recon"], ["d_agree", "recon"], ["d_rec", "recon"], ["recon", "hours"], ["d_csv", "hours"], ["d_agree", "rate"], ["d_rec", "rate"], ["hours", "gross"], ["rate", "gross"], ["gross", "net"], ["d_hand", "net"], ["net", "review"], ...stackEdges],
    };
  }
  if (detail === "complex") {
    return {
      nodes: [hourly ? csv(0, 0.4) : rec(0, 0.4), agree(0, 2), hand(0, 3.6), recon(1, 1.2), calc(2, 2.4), net(3, 2.4), ...stack(4, [1, 2.5, 4])],
      edges: [[hourly ? "d_csv" : "d_rec", "recon"], ["d_agree", "recon"], ["recon", "calc"], ["d_agree", "calc"], ...(hourly ? [["d_csv", "calc"] as [string, string]] : []), ["calc", "net"], ["d_hand", "net"], ["net", "review"], ...stackEdges],
    };
  }
  return {
    nodes: [
      node({ id: "inputs", col: 0, row: 1, group: "Inputs", title: "Their inputs", tag: "Source", stat: "3 sources", text: hourly ? "Agreement, timesheet, handbook" : "Agreement, record, handbook", prov: "document", store: "Policy library and worker records", from: "Provided by Northwind Remote", info: { sub: "Everything comes from documents and records", lines: [hourly ? "The contractor agreement, the October timesheet and the contractor handbook." : "The contractor agreement, the worker record and the contractor handbook."] } }),
      recon(1, 1), { ...calc(2, 1), tag: "Steps 2–5" },
      ...stack(3, [1, 0.5, 1.5]).map((n) => (n.id === "pay" ? { ...n, col: 4, row: 0.5 } : n.id === "audit" ? { ...n, col: 4, row: 1.5 } : n)),
    ],
    edges: [["inputs", "recon"], ["recon", "calc"], ["calc", "review"], ...stackEdges],
  };
}

export function buildGraph(scope: Scope, detail: Detail, who: PersonId, monthIdx: number): Graph {
  return scope === "company" ? companyGraph(detail, monthIdx) : personGraph(detail, who, monthIdx);
}

/** The cap proposal the scripted AI box attaches, per graph (it joins the Reconcile step to the next one). */
export function proposalEdges(g: Graph): [string, string][] {
  const ids = new Set(g.nodes.map((n) => n.id));
  const from = ["recon", "inputs"].find((i) => ids.has(i)) ?? g.nodes[0].id;
  const to = ["calc", "result", "net", "base", "e3", "gross", "ret", "s3"].find((i) => ids.has(i)) ?? g.nodes[g.nodes.length - 1].id;
  return [[from, "prop"], ["prop", to]];
}

export { parseUsd };
