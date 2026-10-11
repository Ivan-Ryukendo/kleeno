// PROTECTED. S21 input privacy, S22 output boundary, S23 injection fixtures. Static + captured-request checks.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runValidated } from "@/core/ai";
import { makeInput } from "@/core/ai/inputs";
import { PolicyInputSchema, policyInput } from "@/core/ai/inputs/policy";
import { PolicyOutputSchema, policySpec } from "@/core/ai/policy";
import { splitPolicy } from "@/core/config";
import { openRouterProvider } from "@/server/ai/openrouter";
import { GOOD, POLICY_TEXT, scripted } from "../../fixtures/ai/policy";
import { INJECTED } from "../../fixtures/ai/injection/outputs";

const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const clauses = splitPolicy(POLICY_TEXT);

describe("S21 input privacy: the adapter's serialized request", () => {
  it("contains exactly the typed input; canary names, addresses, notes and secrets cannot be added", async () => {
    let body = "";
    const fetchFn = (async (_u: unknown, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ model: "m1", choices: [{ message: { content: JSON.stringify(GOOD) } }] }));
    }) as typeof fetch;
    const provider = openRouterProvider({ apiKey: "sk-or-CANARY-SECRET", models: ["m1"], fetchFn });
    await runValidated(provider, policySpec(clauses), policyInput(clauses, "ref"));

    const sent = JSON.parse(body);
    const data = sent.messages[1].content.match(/<data>(.*)<\/data>/s)![1];
    expect(Object.keys(JSON.parse(data)).sort()).toEqual(["clauses", "ruleCatalog"]);
    expect(PolicyInputSchema.safeParse(JSON.parse(data)).success).toBe(true);
    expect(body).not.toContain("CANARY-SECRET");
    expect(sent.provider).toEqual({ require_parameters: true, data_collection: "deny" });

    for (const extra of [{ workerName: "Alice Canary" }, { wallet: "0x" + "a".repeat(40) }, { note: "csv cell text" }]) {
      expect(() => makeInput("POLICY_INTERPRET", PolicyInputSchema, { clauses, ruleCatalog: [], ...extra }, "ref")).toThrow();
    }
  });

  it("falls back to the second model, then fails closed", async () => {
    const seen: string[] = [];
    const fetchFn = (async (_u: unknown, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model;
      seen.push(model);
      return model === "m1" ? new Response("x", { status: 500 }) : new Response(JSON.stringify({ model, choices: [{ message: { content: JSON.stringify(GOOD) } }] }));
    }) as typeof fetch;
    const r = await runValidated(openRouterProvider({ apiKey: "k", models: ["m1", "m2"], fetchFn }), policySpec(clauses), policyInput(clauses, "r"));
    expect([r.status, r.model, seen]).toEqual(["ACCEPTED", "m2", ["m1", "m2"]]);
    const down = (async () => new Response("x", { status: 503 })) as unknown as typeof fetch;
    const f = await runValidated(openRouterProvider({ apiKey: "k", models: ["m1"], fetchFn: down }), policySpec(clauses), policyInput(clauses, "r"));
    expect(f.status).toBe("NEEDS_HUMAN_REVIEW");
  });
});

describe("S22 output boundary", () => {
  const names = (schema: unknown): string[] => {
    const out: string[] = [];
    const walk = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === "object") {
        for (const [k, v] of Object.entries(n)) {
          if (k === "properties" && v && typeof v === "object") out.push(...Object.keys(v));
          walk(v);
        }
      }
    };
    walk(schema);
    return out;
  };

  it("AI result types carry no amount, recipient, wallet, state or approval field", async () => {
    const { z } = await import("zod");
    const fields = names(z.toJSONSchema(PolicyOutputSchema, { target: "draft-7" }));
    expect(fields.filter((f) => /amount|recipient|wallet|address|status|state|approv|pay(?!ro)|gross|net\b/i.test(f))).toEqual([]);
  });

  it("no src file renders raw HTML (S24)", async () => {
    const { readdirSync } = await import("node:fs");
    const walk = (d: string): string[] => readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []));
    expect(walk("src").filter((f) => read(f).includes("dangerouslySetInnerHTML") && !f.includes("/layout.tsx") && !f.includes("seo")), "only JSON-LD may use it").toEqual([]);
  });
});

describe("S23 injection fixtures", () => {
  it.each(Object.entries(INJECTED))("%s is never silently accepted", async (_name, answer) => {
    const r = await runValidated(scripted([answer]), policySpec(clauses), policyInput(clauses, "ref"));
    // Rejected or sent to a human; or, for a value the clauses do not support, accepted only with a flag HR must confirm.
    const safe = r.status === "NEEDS_HUMAN_REVIEW" || r.flags.length > 0;
    expect(safe, JSON.stringify(r)).toBe(true);
  });
});

