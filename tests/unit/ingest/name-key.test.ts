// S42: the name key file is encrypted in the browser and fails closed; codes stay stable across imports.
import { describe, expect, it } from "vitest";
import { mapRows, missingRequired, normalizeDate, suggestMapping } from "@/core/ingest/map";
import { codeFor, emptyNameKey, KDF_ITERATIONS, namesByCode, NameKeyError, openNameKey, sealNameKey } from "@/core/ingest/name-key";
import { parseCsv } from "@/core/ingest/csv";
import { validateRows } from "@/core/ingest/rows";

const PASS = "correct horse battery";

describe("S42 name key file", () => {
  it("handles prototype-like names and reveals only supplied worker codes locally", () => {
    const key = emptyNameKey();
    expect(codeFor(key, "__proto__")).toBe("W001");
    expect(codeFor(key, "constructor")).toBe("W002");
    expect(namesByCode(key, ["W001"])).toEqual({ W001: "__proto__" });
  });
  it("refuses malformed decrypted maps, reused codes and unbounded KDF work", async () => {
    await expect(openNameKey(await sealNameKey({ next: 1, names: { jane: "W001" } }, PASS), PASS)).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });
    await expect(openNameKey(await sealNameKey({ next: 3, names: { jane: "W001", ali: "W001" } }, PASS), PASS)).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });
    const file = JSON.parse(await sealNameKey(emptyNameKey(),PASS));
    await expect(openNameKey(JSON.stringify({ ...file, iter: 1e12 }),PASS)).rejects.toMatchObject({ code: "BAD_FILE" });
  });
  it("round trips and keeps codes stable across imports", async () => {
    const key = emptyNameKey(7);
    expect(codeFor(key, "Jane Doe")).toBe("W007");
    expect(codeFor(key, "  JANE   doe ")).toBe("W007");
    expect(codeFor(key, "Ali Khan")).toBe("W008");
    const file = await sealNameKey(key, PASS);
    const again = await openNameKey(file, PASS);
    expect(codeFor(again, "ali khan")).toBe("W008");
    expect(codeFor(again, "New Person")).toBe("W009");
    const afterOtherWorkers = await openNameKey(file, PASS, 20);
    expect(codeFor(afterOtherWorkers, "ali khan")).toBe("W008");
    expect(codeFor(afterOtherWorkers, "New Person")).toBe("W020");
  });

  it("the file holds no plaintext name, and states a strong KDF", async () => {
    const key = emptyNameKey();
    codeFor(key, "Jane Doe");
    const file = await sealNameKey(key, PASS);
    expect(file.toLowerCase()).not.toContain("jane");
    expect(JSON.parse(file)).toMatchObject({ kdf: "PBKDF2-SHA256", iter: KDF_ITERATIONS });
    expect(KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it("a wrong passphrase, a weak passphrase, an edited file and a downgraded KDF all fail closed", async () => {
    const file = await sealNameKey(emptyNameKey(), PASS);
    await expect(openNameKey(file, "another passphrase!")).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });
    await expect(sealNameKey(emptyNameKey(), "short")).rejects.toBeInstanceOf(NameKeyError);
    const edited = JSON.parse(file);
    edited.ct = edited.ct.slice(0, -4) + "AAAA";
    await expect(openNameKey(JSON.stringify(edited), PASS)).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });
    await expect(openNameKey(JSON.stringify({ ...JSON.parse(file), iter: 1000 }), PASS)).rejects.toMatchObject({ code: "BAD_FILE" });
    await expect(openNameKey("not json", PASS)).rejects.toMatchObject({ code: "BAD_FILE" });
  });
});

describe("mapping and anonymising", () => {
  const csv = "Employee,Date,Hours Worked,Notes\nJane Doe,10/1/2026,8,called in sick\nAli Khan,2026-10-02,7.5,\n";

  it("suggests columns from headers only", () => {
    expect(suggestMapping("TIMESHEETS", parseCsv(csv).headers)).toEqual({ workerRef: 0, date: 1, hours: 2 });
    expect(missingRequired("TIMESHEETS", { workerRef: 0 })).toEqual(["Date", "Hours worked"]);
  });

  it("uploads only mapped fields, with names replaced by codes and US dates normalised", () => {
    const parsed = parseCsv(csv);
    const key = emptyNameKey();
    const items = mapRows("TIMESHEETS", parsed, suggestMapping("TIMESHEETS", parsed.headers), (raw) => (/^W\d{3,}$/.test(raw) ? raw : codeFor(key, raw)));
    expect(items).toEqual([
      { row: 2, data: { workerRef: "W001", date: "2026-10-01", hours: "8" } },
      { row: 3, data: { workerRef: "W002", date: "2026-10-02", hours: "7.5" } },
    ]);
    expect(JSON.stringify(items)).not.toMatch(/Jane|Ali|sick/);
    expect(validateRows("TIMESHEETS", items).rejected).toEqual([]);
  });

  it("dates: ISO and US only", () => {
    expect(normalizeDate("3/9/2026")).toBe("2026-03-09");
    expect(normalizeDate("09.03.2026")).toBe("09.03.2026"); // ambiguous: left alone, rejected later
  });
});
