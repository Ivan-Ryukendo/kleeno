import { beforeEach, expect, it, vi } from "vitest";
const { rpc, seal } = vi.hoisted(() => ({ rpc: vi.fn(), seal: vi.fn() }));
vi.mock("@/server/db/client", () => ({ db: () => ({ rpc }), must: vi.fn() }));
vi.mock("@/server/crypto", () => ({ sealJson: seal, openJson: vi.fn() }));
import { calculatePayroll } from "@/core/engine";
import { saveCalculation } from "@/server/db/calculations";
import { CONFIG, CASES } from "../fixtures/payroll/cases";
beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ error: null }); seal.mockResolvedValue("sealed-synthetic"); });
it("pins v1 to new immutable snapshots and prevents extras from replacing authoritative inputs", async () => {
  const entries = [CASES[0].entry], calc = calculatePayroll(CONFIG, entries);
  await saveCalculation("company", "run", CONFIG, entries, calc, { config: "wrong", entries: [], adjustmentRevision: 0 });
  expect(seal.mock.calls[0][4]).toMatchObject({ config: CONFIG, entries, calculationVersions: { engineVersion: 1, hashVersion: 1 }, adjustmentRevision: 0 });
  expect(rpc).toHaveBeenCalledOnce();
});
it("rejects unsupported pins or inconsistent calculation before encryption and persistence", async () => {
  const entries = [CASES[0].entry], calc = calculatePayroll(CONFIG, entries);
  for (const calculationVersions of [null, {}, { engineVersion: 2, hashVersion: 1 }]) {
    await expect(saveCalculation("company", "run", CONFIG, entries, calc, { calculationVersions })).rejects.toThrow();
  }
  await expect(saveCalculation("company", "run", CONFIG, entries, { ...calc, calculationHash: "f".repeat(64) })).rejects.toThrow();
  expect(seal).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
