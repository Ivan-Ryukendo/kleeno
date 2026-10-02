// PROTECTED. S25: CSV limits, malformed input, no formula evaluation, export escaping, typed server rows.
import { describe, expect, it } from "vitest";
import { CSV_LIMITS, escapeCell, IngestError, parseCsv } from "@/core/ingest/csv";
import { validateRows } from "@/core/ingest/rows";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof IngestError ? e.code : "other";
  }
  return "none";
};

describe("S25 CSV limits and shape", () => {
  it("parses quotes, escaped quotes, CRLF, BOM and semicolon files", () => {
    const r = parseCsv('﻿name;note\r\n"Doe; Jane";"said ""hi"""\r\n');
    expect(r.headers).toEqual(["name", "note"]);
    expect(r.rows).toEqual([["Doe; Jane", 'said "hi"']]);
  });

  it("does not evaluate formulas: the cell is just text", () => {
    expect(parseCsv("a,b\n=SUM(A1:A9),+1\n").rows[0]).toEqual(["=SUM(A1:A9)", "+1"]);
  });

  it("rejects duplicate or empty headers", () => {
    expect(code(() => parseCsv("a,a\n1,2"))).toBe("BAD_HEADERS");
    expect(code(() => parseCsv("a,\n1,2"))).toBe("BAD_HEADERS");
    expect(code(() => parseCsv("A,a\n1,2"))).toBe("BAD_HEADERS");
  });

  it("reports malformed rows by number, never by content", () => {
    try {
      parseCsv("a,b\n1,2\nSECRET-CELL\n3,4\n5");
      throw new Error("should fail");
    } catch (e) {
      expect(e).toBeInstanceOf(IngestError);
      expect((e as IngestError).rows).toEqual([3, 5]);
      expect((e as Error).message).not.toContain("SECRET-CELL");
    }
  });

  it("enforces rows, columns, cell length, size and UTF-8", () => {
    const manyRows = "a\n" + Array(CSV_LIMITS.rows + 1).fill("1").join("\n");
    expect(code(() => parseCsv(manyRows))).toBe("TOO_MANY_ROWS");
    expect(code(() => parseCsv("a\n" + "1\n".repeat(CSV_LIMITS.rows)))).toBe("none");
    expect(code(() => parseCsv(Array.from({ length: CSV_LIMITS.columns + 1 }, (_, i) => `c${i}`).join(",") + "\n"))).toBe("TOO_MANY_COLUMNS");
    expect(code(() => parseCsv("a\n" + "x".repeat(CSV_LIMITS.cellChars + 1)))).toBe("CELL_TOO_LONG");
    expect(code(() => parseCsv("a\n" + "x".repeat(CSV_LIMITS.bytes)))).toBe("TOO_LARGE");
    expect(code(() => parseCsv("a\n�"))).toBe("NOT_UTF8");
    expect(code(() => parseCsv("   "))).toBe("EMPTY");
    expect(code(() => parseCsv('a\n"open'))).toBe("MALFORMED");
  });

  it("the 5 MB cap holds even when no single cell is long", () => {
    const rows = Array(6000).fill("x".repeat(900)).join("\n"); // > 5 MB in 6000 rows (under the row cap)
    expect(code(() => parseCsv("a\n" + rows))).toBe("TOO_LARGE");
  });
});

describe("S25 exports escape spreadsheet formulas", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"])("%j is prefixed", (v) => expect(escapeCell(v)).toBe(`'${v}`));
  it("plain text is untouched", () => expect(escapeCell("W001")).toBe("W001"));
});

describe("S25 the server takes only typed fields", () => {
  const ok = { row: 2, data: { workerRef: "W001", date: "2026-10-01", hours: "8" } };

  it("accepts a clean timesheet row and defaults approved extra hours to 0", () => {
    const r = validateRows("TIMESHEETS", [ok]);
    expect(r.good[0].value).toEqual({ workerRef: "W001", date: "2026-10-01", hours: "8", approvedExtraHours: "0" });
  });

  it.each([
    [{ workerRef: "Jane Doe", date: "2026-10-01", hours: "8" }, "workerRef", "BAD_VALUE"],
    [{ workerRef: "W001", date: "2026-02-31", hours: "8" }, "date", "BAD_VALUE"],
    [{ workerRef: "W001", date: "2026-10-01", hours: "25" }, "hours", "BAD_VALUE"],
    [{ workerRef: "W001", date: "2026-10-01", hours: "-1" }, "hours", "BAD_VALUE"],
    [{ workerRef: "W001", date: "2026-10-01" }, "hours", "MISSING"],
    [{ workerRef: "W001", date: "2026-10-01", hours: "8", note: "free text" }, "row", "BAD_VALUE"],
  ])("rejects %j", (data, field, code) => {
    const r = validateRows("TIMESHEETS", [{ row: 7, data }]);
    expect(r.good).toEqual([]);
    expect(r.rejected).toEqual([{ row: 7, field, code }]);
  });

  it("non-USD amounts are rejected as CURRENCY (rule 7)", () => {
    expect(validateRows("ACTUAL_PAID", [{ row: 3, data: { workerRef: "W001", amount: "100", currency: "EUR" } }]).rejected).toEqual([{ row: 3, field: "currency", code: "CURRENCY" }]);
    expect(validateRows("ACTUAL_PAID", [{ row: 3, data: { workerRef: "W001", amount: "100.50" } }]).good).toHaveLength(1);
  });

  it("amounts are exact decimals up to 6 places, capped", () => {
    expect(validateRows("ACTUAL_PAID", [{ row: 2, data: { workerRef: "W001", amount: "1e9" } }]).good).toEqual([]);
    expect(validateRows("ACTUAL_PAID", [{ row: 2, data: { workerRef: "W001", amount: "0.1234567" } }]).good).toEqual([]);
    expect(validateRows("ACTUAL_PAID", [{ row: 2, data: { workerRef: "W001", amount: "2000000000" } }]).good).toEqual([]);
  });
});
