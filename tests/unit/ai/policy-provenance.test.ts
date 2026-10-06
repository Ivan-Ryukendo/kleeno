import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { validatedPolicyDocuments } from "@/core/config";
import { WorkerMetadataSchema } from "@/core/workers";

it("revalidates reviewed text, per-document hashes, unique clause IDs and bounded page anchors", () => {
  const text = "Employees work 160 hours per period.";
  const d = { id: randomUUID(), format: "pdf", contentHash: createHash("sha256").update(text).digest("hex"), clauses: [{ id: "C001", text, anchor: "page:1:paragraph:1" }] };
  expect(validatedPolicyDocuments(text, [d]).clauses).toEqual([{ id: "C001", text }]);
  for (const documents of [[{ ...d, contentHash: "0".repeat(64) }], [{ ...d, clauses: [{ ...d.clauses[0], anchor: "page:101:paragraph:1" }] }], [d, { ...d, id: randomUUID() }], [{ ...d, filename: "private.pdf" }]]) expect(() => validatedPolicyDocuments(text, documents)).toThrow();
  expect(() => validatedPolicyDocuments("Changed text", [d])).toThrow(/do not match/);
});
it("worker evidence rejects duplicate tags, invalid dates and reversed employment", () => {
  for (const input of [{ tags: ["remote", "remote"] }, { employmentStart: "2026-02-30" }, { employmentStart: "2026-10-20", employmentEnd: "2026-10-01" }]) expect(WorkerMetadataSchema.safeParse(input).success).toBe(false);
});
