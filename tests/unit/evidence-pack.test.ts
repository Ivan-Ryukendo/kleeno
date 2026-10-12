import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { canonicalString } from "@/core/canonical";
import { calculatePayroll, type EngineEntry } from "@/core/engine";
import { buildReviewExport } from "@/core/workflow/review";
import { buildEvidencePack, EVIDENCE_PACK_MAX_BYTES } from "@/core/workflow/evidence-pack";
import { CASES, CONFIG } from "../fixtures/payroll/cases";

const id = "10000000-0000-4000-8000-000000000001";
function fixture() {
  const entries = [CASES[0].entry], calculation = calculatePayroll(CONFIG, entries);
  const run = { id, periodStart: "2026-10-01", periodEnd: "2026-10-31" };
  const csv = buildReviewExport({ calculationId: id, calculationHash: calculation.calculationHash, configVersion: CONFIG.version, periodStart: run.periodStart, periodEnd: run.periodEnd, lines: calculation.lines });
  return { companyId: id, run, calculation: { id, calculationHash: calculation.calculationHash, configVersion: CONFIG.version }, snapshot: JSON.parse(canonicalString({ config: CONFIG, entries, evidence: { timesheets: [{ id, source_hash: "c".repeat(64) }], leave: [], actualPayments: [] }, decisions: {}, adjustmentRevision: 0 })), lines: calculation.lines, signoff: { id, actor: id, at: "2026-10-07T12:00:00Z", calculationId: id, calculationHash: calculation.calculationHash }, exported: { id, at: "2026-10-07T12:01:00Z", calculationId: id, calculationHash: calculation.calculationHash, signoffId: id, formatVersion: csv.formatVersion, byteHash: csv.byteHash, totals: csv.totals } };
}

it("builds deterministic fixed-path ZIP with exact money, source provenance and independently verifiable file hashes", () => {
  const input = fixture(), first = buildEvidencePack(input), second = buildEvidencePack(input);
  expect(first.bytes).toEqual(second.bytes);
  const files = unzipSync(first.bytes);
  expect(Object.keys(files).sort()).toEqual(["calculation.json", "manifest.json", "payroll.csv", "review.json", "snapshot.json"]);
  const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
  expect(manifest).toMatchObject({ schemaVersion: 1, scope: "SIGNED_CALCULATION_EVIDENCE", calculationHash: input.calculation.calculationHash });
  for (const file of manifest.files) {
    expect(file.byteLength).toBe(files[file.path].byteLength);
    expect(file.sha256).toBe(createHash("sha256").update(files[file.path]).digest("hex"));
  }
  expect(new TextDecoder().decode(files["calculation.json"])).toContain('"gross":"2000000000"');
  expect(new TextDecoder().decode(files["snapshot.json"])).toContain("c".repeat(64));
  expect(new TextDecoder().decode(files["review.json"])).toContain("2026-10-07T12:00:00Z");
  expect(manifest.limits).toContain("Comparison baseline was not captured by this sign-off");
  expect(first.byteHash).toBe(createHash("sha256").update(first.bytes).digest("hex"));
  expect(first.filename).toBe(`kleeno-signed-calculation-v1-${id}.zip`);
});

it("refuses incomplete/duplicate worker sets, changed traces, inputs, immutable hash and export totals", () => {
  const input = fixture();
  const changedInput = structuredClone(input.snapshot); changedInput.entries[0].input.workedHours = "4";
  const changedTrace = input.lines.map(line => ({ ...line, trace: line.trace.map((trace, index) => index ? trace : { ...trace, source: "invented-source" }) }));
  for (const change of [{ lines: [] }, { lines: [...input.lines, ...input.lines] }, { lines: changedTrace }, { snapshot: changedInput }, { calculation: { ...input.calculation, calculationHash: "f".repeat(64) } }, { exported: { ...input.exported, totals: { ...input.exported.totals, net: "0" } } }, { exported: { ...input.exported, byteHash: "f".repeat(64) } }, { signoff: { ...input.signoff, calculationId: "20000000-0000-4000-8000-000000000002" } }, { exported: { ...input.exported, signoffId: "20000000-0000-4000-8000-000000000002" } }]) {
    expect(() => buildEvidencePack({ ...input, ...change })).toThrow();
  }
});

it("rejects identifying/unknown snapshot fields and oversize content rather than exporting arbitrary captured objects", () => {
  const input = fixture();
  for (const field of ["name", "email", "wallet", "recipient", "nameKey"]) {
    const snapshot = structuredClone(input.snapshot); snapshot.entries[0].worker[field] = "PRIVATE-person";
    expect(() => buildEvidencePack({ ...input, snapshot })).toThrow();
  }
  expect(() => buildEvidencePack({ ...input, snapshot: { ...input.snapshot, tasks: [{ nextAction: "mutable" }] } })).toThrow();
  expect(EVIDENCE_PACK_MAX_BYTES).toBe(20 * 1024 * 1024);
  expect(() => buildEvidencePack({ ...input, snapshot: { ...input.snapshot, config: { ...input.snapshot.config, employeeEmail: "private@example.com" } } })).toThrow();
  expect(() => buildEvidencePack({ ...input, snapshot: { ...input.snapshot, entries: [{ ...input.snapshot.entries[0], input: { ...input.snapshot.entries[0].input, notes: "private" } }] } })).toThrow();
  expect(() => buildEvidencePack({ ...input, snapshot: { ...input.snapshot, unknown: "x".repeat(EVIDENCE_PACK_MAX_BYTES) } })).toThrow("20MiB");
});

it("keeps ZIP timestamps and bytes stable across host timezones", () => {
  const input = fixture();
  try {
    vi.stubEnv("TZ", "America/New_York");
    const first = buildEvidencePack(input);
    vi.stubEnv("TZ", "Asia/Dhaka");
    expect(buildEvidencePack(input).bytes).toEqual(first.bytes);
  } finally { vi.unstubAllEnvs(); }
});

it("replays approved dated compensation evidence and rejects tampered segment or dated-hour fields", () => {
  const input = fixture(), config = { ...CONFIG, prorationMethod: "ACTUAL_CALENDAR_DAYS" as const };
  const entry: EngineEntry = { ...CASES[0].entry, period: { start: input.run.periodStart, end: input.run.periodEnd },
    input: { workedHours: "40", datedHours: [{ date: "2026-10-02", workedHours: "20" }, { date: "2026-10-20", workedHours: "20" }] },
    compensationSegments: [
      { start: "2026-10-01", end: "2026-10-15", effectiveFrom: "2026-10-01", sourceId: id, sourceVersion: 1, payType: "SALARIED", baseAmount: "2000000000", hourlyRate: "0" },
      { start: "2026-10-16", end: "2026-10-31", effectiveFrom: "2026-10-16", sourceId: "20000000-0000-4000-8000-000000000002", sourceVersion: 2, payType: "SALARIED", baseAmount: "3000000000", hourlyRate: "0" },
    ] };
  const result = calculatePayroll(config, [entry]);
  const csv = buildReviewExport({ calculationId: id, calculationHash: result.calculationHash, configVersion: config.version, periodStart: input.run.periodStart, periodEnd: input.run.periodEnd, lines: result.lines });
  const bound = { ...input, snapshot: JSON.parse(canonicalString({ config, entries: [entry] })), lines: result.lines,
    calculation: { ...input.calculation, calculationHash: result.calculationHash }, signoff: { ...input.signoff, calculationHash: result.calculationHash },
    exported: { ...input.exported, calculationHash: result.calculationHash, byteHash: csv.byteHash, totals: csv.totals } };
  const files = unzipSync(buildEvidencePack(bound).bytes);
  expect(JSON.parse(new TextDecoder().decode(files["snapshot.json"]))).toEqual(bound.snapshot);
  for (const corrupt of [
    (snapshot: typeof bound.snapshot) => { snapshot.entries[0].compensationSegments[1].baseAmount = "4000000000"; },
    (snapshot: typeof bound.snapshot) => { snapshot.entries[0].compensationSegments[0].employeeName = "private"; },
    (snapshot: typeof bound.snapshot) => { snapshot.entries[0].input.datedHours[0].workedHours = "19"; },
    (snapshot: typeof bound.snapshot) => { snapshot.entries[0].input.datedHours[0].note = "private"; },
  ]) {
    const snapshot = structuredClone(bound.snapshot); corrupt(snapshot);
    expect(() => buildEvidencePack({ ...bound, snapshot })).toThrow();
  }
});
