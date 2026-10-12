import { expect, it, vi } from "vitest";
import { calculatePayroll } from "@/core/engine";
import { CONFIG, CASES } from "../fixtures/payroll/cases";
const mocks = vi.hoisted(() => ({ seal: vi.fn<(...args: unknown[]) => Promise<string>>(async () => "ENCRYPTED"), rpc: vi.fn(async () => ({ error: null })) }));
vi.mock("@/server/crypto", () => ({ sealJson: mocks.seal }));
vi.mock("@/server/db/client", () => ({ db: () => ({ rpc: mocks.rpc }) }));
import { saveCalculation } from "@/server/db/calculations";
it("sends schedule revision fencing separately from legacy encrypted snapshot/hash fields", async () => {
  const entries = [CASES[0].entry], calc = calculatePayroll(CONFIG, entries);
  await saveCalculation("company", "run", CONFIG, entries, calc, {}, { [entries[0].worker.workerId]: 0 }, "reviewer");
  expect(mocks.seal.mock.calls[0][4]).toEqual({ config: CONFIG, entries, calculationVersions: { engineVersion: 1, hashVersion: 1 } });
  expect(mocks.rpc).toHaveBeenCalledWith("save_calculation", expect.objectContaining({ p_calc: expect.objectContaining({ actor_id: "reviewer", compensation_revisions: { [entries[0].worker.workerId]: 0 }, calculation_hash: calc.calculationHash }) }));
});
