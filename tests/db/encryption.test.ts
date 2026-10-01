// S41: no plaintext canary in any encrypted column; ciphertext bound to its row and company; repositories still decrypt.
import { beforeAll, describe, expect, it } from "vitest";
import { openField } from "@/server/crypto";
import { loadConfig } from "@/server/db/configs";
import { listWorkers } from "@/server/db/workers";
import { activeConfig, admin, approvedRun, CANARY_BASE, CANARY_CLAUSE, makeCompany, userClient, type BuiltRun, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
let built: BuiltRun;
const TABLES = ["compensations", "payroll_configurations", "calculations", "calculation_lines"] as const;
const CANARIES = [CANARY_CLAUSE, CANARY_BASE, CANARY_BASE.replace(".", ""), "BASE_SALARY"];

beforeAll(async () => {
  a = await makeCompany({ live: true });
  b = await makeCompany({ live: true });
  built = await approvedRun(a, await activeConfig(a));
});

describe("S41 at rest", () => {
  it("no plaintext canary appears in any encrypted column (clause text, compensation, snapshot, line amounts)", async () => {
    for (const t of TABLES) {
      const rows = (await admin.from(t).select("*").eq("company_id", a.id)).data ?? [];
      expect(rows.length, t).toBeGreaterThan(0);
      const encrypted = rows.flatMap((r) => Object.entries(r).filter(([k]) => k.endsWith("_enc")));
      expect(encrypted.length, t).toBeGreaterThan(0);
      for (const [k, v] of encrypted) for (const c of CANARIES) expect(String(v), `${t}.${k}`).not.toContain(c);
    }
  });

  it("the wrapped company key is stored as opaque base64", async () => {
    const keys = (await admin.from("company_keys").select("company_id, wrapped_key").eq("company_id", a.id)).data ?? [];
    expect(keys).toHaveLength(1);
    expect(keys[0].wrapped_key).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe("S41 binding", () => {
  it("ciphertext cannot be opened as another row, column or company", async () => {
    const comp = (await admin.from("compensations").select("id, payload_enc").eq("company_id", a.id).limit(1).single()).data!;
    await expect(openField(a.id, "compensations", "payload_enc", comp.id, comp.payload_enc)).resolves.toContain("baseAmount");
    await expect(openField(a.id, "compensations", "payload_enc", built.workerId, comp.payload_enc)).rejects.toThrow();
    await expect(openField(a.id, "compensations", "other_enc", comp.id, comp.payload_enc)).rejects.toThrow();
    await expect(openField(b.id, "compensations", "payload_enc", comp.id, comp.payload_enc)).rejects.toThrow();
  });

  it("repositories decrypt for the owning company; the user-scoped raw read is ciphertext only", async () => {
    const ua = await userClient(a.payroll);
    const workers = await listWorkers(ua, a.id);
    expect(workers[0].compensation?.baseAmount).toBe(BigInt(CANARY_BASE.replace(".", "")));
    const cfg = await loadConfig(a.id, built.config.version);
    expect(cfg?.clauses.find((c) => c.id === "C1")?.text).toBe(CANARY_CLAUSE);
    const raw = (await ua.from("compensations").select("payload_enc")).data ?? [];
    expect(JSON.stringify(raw)).not.toContain("1234567");
  });
});
