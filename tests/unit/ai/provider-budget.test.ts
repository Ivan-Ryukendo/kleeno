import { describe, expect, it, vi } from "vitest";
import { runValidated } from "@/core/ai";
import { policyInput } from "@/core/ai/inputs/policy";
import { policySpec } from "@/core/ai/policy";
import { splitPolicy } from "@/core/config";
import { openRouterProvider } from "@/server/ai/openrouter";
import { GOOD, POLICY_TEXT } from "../../fixtures/ai/policy";
import { INJECTED } from "../../fixtures/ai/injection/outputs";

const clauses = splitPolicy(POLICY_TEXT);
const execute = (provider: ReturnType<typeof openRouterProvider>) => runValidated(provider, policySpec(clauses), policyInput(clauses, "synthetic-ref"));
const response = (model: string, output: unknown = GOOD) => new Response(JSON.stringify({ model, choices: [{ message: { content: JSON.stringify(output) } }] }));
describe("R6.4 mocked AI budget and drift boundary", () => {
  it("does not send HTTP when the atomic company reservation rejects", async () => {
    const fetchFn = vi.fn(async () => response("m1"));
    const reserve = vi.fn(async () => { throw new Error("budget exhausted"); });
    const result = await execute(openRouterProvider({ apiKey: "synthetic", models: ["m1", "m2"], fetchFn, reserve }));
    expect(result.status).toBe("NEEDS_HUMAN_REVIEW");
    expect(reserve).toHaveBeenCalledOnce();
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("reserves each fallback and repair before HTTP and stops at breach without refunding unknown calls", async () => {
    let attempts = 0, used = 0;
    const events: string[] = [];
    const reserve = vi.fn(async (tokens: number) => { events.push("reserve"); if (attempts >= 2) throw new Error("daily cap"); used += tokens; });
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      events.push("fetch"); attempts++;
      const request = JSON.parse(String(init?.body));
      expect(request.max_tokens).toBe(2000);
      expect(request.reasoning).toEqual({ enabled: false });
      return attempts === 1 ? new Response("temporary", { status: 503 }) : response(request.model, { approved: true });
    });
    const provider = openRouterProvider({ apiKey: "synthetic", models: ["m1", "m2"], fetchFn, reserve });
    expect((await execute(provider)).status).toBe("NEEDS_HUMAN_REVIEW");
    expect(events).toEqual(["reserve", "fetch", "reserve", "fetch", "reserve"]);
    expect(provider.telemetry?.()).toMatchObject({ attempts: 2, reservedTokens: used, budgetEnforced: true });
  });
  it("pins routing before awaits and refuses provider-returned model drift", async () => {
    const models = ["m1", "m2"], sent: string[] = [];
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model; sent.push(model); models[1] = "unapproved-model";
      return model === "m1" ? response("different-model") : response(model);
    });
    const result = await execute(openRouterProvider({ apiKey: "synthetic", models, fetchFn, reserve: async () => undefined }));
    expect(result).toMatchObject({ status: "ACCEPTED", model: "m2" });
    expect(sent).toEqual(["m1", "m2"]);
  });
  it("fails closed for oversize serialized requests and response streams", async () => {
    const fetchFn = vi.fn(async () => new Response("x".repeat(300000)));
    const reserve = vi.fn(async () => undefined);
    expect((await execute(openRouterProvider({ apiKey: "synthetic", models: ["m1"], fetchFn, reserve }))).status).toBe("NEEDS_HUMAN_REVIEW");
    const provider = openRouterProvider({ apiKey: "synthetic", models: ["m1"], fetchFn, reserve });
    await expect(provider.complete({ system: "x".repeat(300000), input: policyInput(clauses, "ref"), repair: null, schemaName: "policy", jsonSchema: {} })).rejects.toThrow();
  });
  it("versioned injection set never silently accepts hostile output across bounded repairs", async () => {
    for (const output of Object.values(INJECTED)) {
      const fetchFn = vi.fn(async () => response("m1", output));
      const result = await execute(openRouterProvider({ apiKey: "synthetic", models: ["m1"], fetchFn, reserve: async () => undefined }));
      expect(result.status === "NEEDS_HUMAN_REVIEW" || result.flags.length > 0).toBe(true);
      expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(3);
    }
  });
});
