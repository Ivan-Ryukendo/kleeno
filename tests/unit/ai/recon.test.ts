// ReconciliationAgent contract: typed facts only (S21), suggestions only from the allowed options (S22), hostile output rejected (S23).
import { describe, expect, it } from "vitest";
import { runValidated } from "@/core/ai";
import { reconInput, ReconInputSchema, type ReconItem } from "@/core/ai/inputs/recon";
import { reconSpec } from "@/core/ai/recon";
import { scripted } from "../../fixtures/ai/policy";

const item = (over: Partial<ReconItem> = {}): ReconItem => ({ ref: "e1", category: "DUPLICATE_TIMESHEET", payType: "HOURLY", facts: { date: "2026-10-07", rows: "2", hours: "8,8" }, options: ["KEEP_FIRST", "KEEP_LATEST", "KEEP_ALL"], ...over });
const run = (items: ReconItem[], answers: Parameters<typeof scripted>[0]) => {
  const p = scripted(answers);
  return runValidated(p, reconSpec(items), reconInput(items, "ref")).then((r) => ({ r, p }));
};
const good = (action: string | null = "KEEP_FIRST") => ({ suggestions: [{ ref: "e1", action, confidence: "HIGH" }] });

describe("S21 recon input is numbers, dates and enums only", () => {
  it("accepts the facts reconciliation produces", () => {
    expect(ReconInputSchema.safeParse({ items: [item()] }).success).toBe(true);
  });

  it.each([
    ["a name in a fact", { date: "Jane Doe" }],
    ["free text in a fact", { hours: "8, but she was sick" }],
    ["an unknown fact key", { note: "8" }],
    ["an address", { date: "0xabc" }],
  ])("rejects %s", (_n, facts) => {
    expect(ReconInputSchema.safeParse({ items: [item({ facts: facts as ReconItem["facts"] })] }).success).toBe(false);
  });

  it("rejects extra item fields such as a worker name", () => {
    expect(ReconInputSchema.safeParse({ items: [{ ...item(), workerName: "Jane" }] }).success).toBe(false);
  });
});

describe("S22/S23 suggestions", () => {
  it("a suggestion from the allowed options is accepted; null (\"I can't tell\") is accepted", async () => {
    expect((await run([item()], [good()])).r.status).toBe("ACCEPTED");
    expect((await run([item()], [good(null)])).r.status).toBe("ACCEPTED");
  });

  it.each([
    ["an action outside the item's options", good("APPROVE_HOURS")],
    ["a ref that was never asked", { suggestions: [{ ref: "e9", action: null, confidence: "LOW" }] }],
    ["a missing ref", { suggestions: [] }],
    ["the same ref twice", { suggestions: [good().suggestions[0], good().suggestions[0]] }],
    ["an extra approve field", { ...good(), approved: true }],
    ["an explanation with a link", { suggestions: [{ ...good().suggestions[0], why: "see https://evil.example" }] }],
  ])("%s is never accepted", async (_n, answer) => {
    const { r } = await run([item()], [answer]);
    expect(r.status).toBe("NEEDS_HUMAN_REVIEW");
    expect(r.output).toBeNull();
  });

  it("a bad first answer is repaired and the repair loop is recorded", async () => {
    const { r } = await run([item()], [good("APPROVE_HOURS"), good()]);
    expect(r.status).toBe("REPAIRED");
    expect(r.repairs).toEqual([["e1: APPROVE_HOURS is not one of its options"]]);
  });
});
