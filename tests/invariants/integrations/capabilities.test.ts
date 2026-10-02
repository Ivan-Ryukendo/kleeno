// PROTECTED. S47 capabilities fail closed (vendor-free core is checked in security/app-structure); no capability for approval/payment/recipient/state. S46 provenance schema.
import { describe, expect, it } from "vitest";
import { CAPABILITIES, CapabilityError, ProvenanceSchema, requireCapability } from "@/core/integrations";

describe("S47 capabilities", () => {
  it("csv_upload declares read-only evidence capabilities", () => {
    for (const c of CAPABILITIES) expect(requireCapability("csv_upload", c).id).toBe("csv_upload");
  });

  it("an unknown provider or undeclared capability fails closed", () => {
    expect(() => requireCapability("some_hris", "workers.read")).toThrow(CapabilityError);
    expect(() => requireCapability("csv_upload", "payments.execute" as never)).toThrow(CapabilityError);
  });

  it("no capability grants approval, payment, recipient or state change", () => {
    expect(CAPABILITIES.filter((c) => /approve|execute|submit|recipient|state|write|pay(?!ments_made)/i.test(c))).toEqual([]);
  });
});

describe("S46 provenance schema", () => {
  const ok = { sourceProvider: "csv_upload", objectType: "timesheet", objectId: "W001|2026-10-01", fetchedAt: "2026-10-02T10:00:00.000Z", sourceHash: "a".repeat(64), reference: "11111111-1111-4111-8111-111111111111" };

  it("accepts a complete record", () => expect(ProvenanceSchema.safeParse(ok).success).toBe(true));

  it.each(["sourceProvider", "objectType", "objectId", "fetchedAt", "sourceHash", "reference"])("rejects a record without %s", (k) => {
    expect(ProvenanceSchema.safeParse({ ...ok, [k]: undefined }).success).toBe(false);
  });

  it("rejects an unknown provider and raw payload fields", () => {
    expect(ProvenanceSchema.safeParse({ ...ok, sourceProvider: "mystery" }).success).toBe(false);
    expect(ProvenanceSchema.safeParse({ ...ok, rawPayload: "{}" }).success).toBe(false);
  });
});
