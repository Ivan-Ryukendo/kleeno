import { describe, expect, it } from "vitest";
import { canonicalString } from "@/core/canonical";
import { calculatePayroll } from "@/core/engine";
import { verifyCapturedCalculation } from "@/core/workflow/evidence-pack";
import { CASES, CONFIG } from "../fixtures/payroll/cases";
import { VERSION1_HASHES, VERSION1_COMBINED_HASH } from "../fixtures/payroll/version1";

const versions = { engineVersion: 1, hashVersion: 1 };
const unknownVersions = [null, {}, { engineVersion: 1 }, { hashVersion: 1 }, { engineVersion: 2, hashVersion: 1 }, { engineVersion: 1, hashVersion: 2 }, { engineVersion: "1", hashVersion: 1 }, { ...versions, fallback: true }];
describe("captured engine/hash compatibility", () => {
  it("reproduces every frozen pre-version hash with legacy calls and explicit v1 dispatch", () => {
    expect(CASES).toHaveLength(VERSION1_HASHES.length);
    for (const [index, fixture] of CASES.entries()) {
      expect(calculatePayroll(fixture.config ?? CONFIG, [fixture.entry]).calculationHash).toBe(VERSION1_HASHES[index]);
      expect(calculatePayroll(fixture.config ?? CONFIG, [fixture.entry], versions).calculationHash).toBe(VERSION1_HASHES[index]);
    }
    const entries = CASES.filter(fixture => !fixture.config).map(fixture => fixture.entry).reverse();
    expect(calculatePayroll(CONFIG, entries, versions).calculationHash).toBe(VERSION1_COMBINED_HASH);
  });
  it("does not silently calculate using current code for unsupported or malformed versions", () => {
    for (const version of unknownVersions) expect(() => calculatePayroll(CONFIG, [CASES[0].entry], version)).toThrow();
  });
  it("replays unversioned and version-pinned captured snapshots with the same historic hash", () => {
    const entry = CASES[0].entry, result = calculatePayroll(CONFIG, [entry]);
    const input = { run: { id: "10000000-0000-4000-8000-000000000001", periodStart: "2026-10-01", periodEnd: "2026-10-31" }, calculation: { id: "10000000-0000-4000-8000-000000000002", configVersion: 1, calculationHash: VERSION1_HASHES[0] }, lines: result.lines };
    const snapshot = JSON.parse(canonicalString({ config: CONFIG, entries: [entry] }));
    expect(verifyCapturedCalculation({ ...input, snapshot }).calculated.calculationHash).toBe(VERSION1_HASHES[0]);
    expect(verifyCapturedCalculation({ ...input, snapshot: { ...snapshot, calculationVersions: versions } }).calculated.calculationHash).toBe(VERSION1_HASHES[0]);
    for (const version of unknownVersions) expect(() => verifyCapturedCalculation({ ...input, snapshot: { ...snapshot, calculationVersions: version } })).toThrow();
  });
});
