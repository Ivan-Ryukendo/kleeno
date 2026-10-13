import { describe, expect, it } from "vitest";
import { buildGraph, danielTrace, kenjiTrace, monthlyPayCard, peopleList, personInfo, type Detail, type Graph, type PersonId, type Scope } from "@/components/landing-demo-graph";
import { monthRows, monthSummary, months, parseUsd, usd, workers } from "@/components/landing-demo-data";

// The Workflow tab must stay traceable: every card names where its data is stored and where it came from, every card leads
// to the audit record, and no two cards in a column overlap. These checks run on every scope, level of detail and month.

const details: Detail[] = ["simple", "complex", "detailed"];
const variants: { scope: Scope; who: PersonId; monthIdx: number }[] = [];
for (let m = 0; m < months.length; m++) {
  variants.push({ scope: "company", who: "W008", monthIdx: m });
  // every worker has a person workflow, whether it is working or not
  for (const w of workers) if (m === 0 || m === 3) variants.push({ scope: "person", who: w.code, monthIdx: m });
}

function reachesAudit(g: Graph, id: string) {
  const seen = new Set<string>();
  const walk = (x: string): boolean => {
    if (x === "audit") return true;
    if (seen.has(x)) return false;
    seen.add(x);
    return g.edges.filter(([a]) => a === x).some(([, b]) => walk(b));
  };
  return walk(id);
}

describe.each(variants.flatMap((v) => details.map((d) => ({ ...v, detail: d }))))("$scope $who $detail, month $monthIdx", ({ scope, who, detail, monthIdx }) => {
  const g = buildGraph(scope, detail, who, monthIdx);
  const ids = new Set(g.nodes.map((n) => n.id));

  it("has unique cards and edges that point at real cards", () => {
    expect(ids.size).toBe(g.nodes.length);
    for (const [a, b] of g.edges) {
      expect(ids.has(a), `edge from ${a}`).toBe(true);
      expect(ids.has(b), `edge to ${b}`).toBe(true);
    }
    expect(new Set(g.edges.map(([a, b]) => `${a}>${b}`)).size).toBe(g.edges.length);
  });

  it("names where every card is stored and where it came from, and ends in the audit record", () => {
    for (const n of g.nodes) {
      expect(n.store.length, `${n.id} store`).toBeGreaterThan(3);
      expect(n.from.length, `${n.id} from`).toBeGreaterThan(3);
      expect(n.info.sub.length, `${n.id} sub`).toBeGreaterThan(3);
      expect(reachesAudit(g, n.id), `${n.id} reaches audit`).toBe(true);
    }
    // Every card that is not a starting point has something feeding it.
    const fed = new Set(g.edges.map(([, b]) => b));
    for (const n of g.nodes) if (!fed.has(n.id)) expect(["document", "import", "record"], `${n.id} is a source`).toContain(n.prov);
  });

  it("keeps cards in a column clear of each other", () => {
    const byCol = new Map<number, number[]>();
    for (const n of g.nodes) byCol.set(n.col, [...(byCol.get(n.col) ?? []), n.row]);
    for (const [col, rows] of byCol) {
      const s = [...rows].sort((a, b) => a - b);
      for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1], `column ${col}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("the numbers", () => {
  it("Daniel Okafor's 18 steps match payroll-calculation.html", () => {
    const t = danielTrace();
    expect(usd(t.base)).toBe("$6,500.00");
    expect(usd(t.ot)).toBe("$332.39");
    expect(usd(t.wages)).toBe("$6,982.39");
    expect(usd(t.gross)).toBe("$7,061.39");
    expect([t.pension, t.tax, t.ss, t.medicare].map(usd)).toEqual(["$349.12", "$795.99", "$432.91", "$101.24"]);
    expect(usd(t.deductions)).toBe("$1,679.26");
    expect(usd(t.net)).toBe("$5,382.13");
    expect([usd(t.erTax), usd(t.match)]).toEqual(["$534.15", "$279.30"]);
  });

  it("his base salary is the Monthly pay in the table, and the detailed graph has all 18 steps", () => {
    expect(usd(monthRows(0).find((w) => w.code === "W008") ? Number(monthRows(0).find((w) => w.code === "W008")!.monthly.replace(/[^0-9.]/g, "")) : 0)).toBe(usd(danielTrace().base));
    const g = buildGraph("person", "detailed", "W008", 0);
    for (let i = 1; i <= 18; i++) expect(g.nodes.some((n) => n.id === `s${i}`), `step ${i}`).toBe(true);
  });

  it("Kenji's pay is the table's Monthly pay, and he is flagged only when over the 140 h cap", () => {
    for (let k = 0; k < months.length; k++) {
      expect(usd(kenjiTrace(k).pay)).toBe(monthRows(k).find((w) => w.code === "W004")!.monthly);
      const recon = buildGraph("person", "complex", "W004", k).nodes.find((n) => n.id === "recon")!;
      expect(recon.tone).toBe(months[k].kenjiHours > 140 ? "warn" : "ok");
    }
  });

  it("company figures agree with the table", () => {
    const s = monthSummary(monthRows(0));
    const g = buildGraph("company", "complex", "W008", 0);
    expect(g.nodes.find((n) => n.id === "base")!.stat).toBe(usd(s.total));
    expect(g.nodes.find((n) => n.id === "tax")!.stat).toBe(s.footer.tax!.replace("Sum ", ""));
    expect(g.nodes.find((n) => n.id === "allow")!.stat).toBe("+$750.00"); // 5 employees x $150
    expect(g.nodes.find((n) => n.id === "recon")!.stat).toBe("12 of 14");
  });
});

describe("every worker can be found and traced", () => {
  it("lists all 14 people with a status and the checks behind it", () => {
    const list = peopleList(0);
    expect(list).toHaveLength(14);
    expect(list.filter((p) => p.status === "review").map((p) => p.id)).toEqual(["W004"]);
    expect(list.filter((p) => p.status === "hold").map((p) => p.id)).toEqual(["W014"]);
    expect(list.filter((p) => p.status === "matched")).toHaveLength(12);
    for (const p of list) {
      expect(p.checks.length).toBeGreaterThanOrEqual(4);
      expect(p.checks.every((c) => c.ok)).toBe(p.status === "matched"); // a failed check explains every review or hold
      expect(p.reason.length).toBeGreaterThan(20);
    }
    expect(personInfo("W004", 0).reason).toContain("142 h");
    expect(personInfo("W014", 0).reason).toContain("Wallet changed");
  });

  it("past months have nobody under review", () => {
    for (const k of [1, 2, 3]) expect(peopleList(k).every((p) => p.status === "matched")).toBe(true);
  });

  it("the detailed card for monthly pay exists and shows the pay from the table", () => {
    for (const w of workers) {
      const g = buildGraph("person", "detailed", w.code, 0);
      const card = g.nodes.find((n) => n.id === monthlyPayCard(w.code));
      expect(card, w.code).toBeTruthy();
      expect(parseUsd(card!.stat), w.code).toBe(parseUsd(monthRows(0).find((x) => x.code === w.code)!.monthly));
    }
  });
});
