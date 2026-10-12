import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseXlsx, sheetToCsv } from "@/core/ingest/xlsx";
import { mapRows, suggestMapping } from "@/core/ingest/map";
import { codeFor, emptyNameKey } from "@/core/ingest/name-key";
import { validateRows } from "@/core/ingest/rows";

function workbook(rowOverride?: string) {
  return zipSync(Object.fromEntries(Object.entries({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hours" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/><Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>',
    "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Date</t></is></c><c r="C1" t="inlineStr"><is><t>Hours</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Jane Canary</t></is></c><c r="B2" t="inlineStr"><is><t>2026-10-01</t></is></c><c r="C2"><f>4+4</f><v>8</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Jane Canary</t></is></c><c r="B3" t="inlineStr"><is><t>2026-10-02</t></is></c><c r="C3"><f>EXECUTE_EVIL()</f></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet2.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Currency</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>EUR</t></is></c></row></sheetData></worksheet>',
    "xl/vbaProject.bin": "NEVER_EXECUTED",
  }).map(([k,v]) => [k,strToU8(k === "xl/worksheets/sheet1.xml" && rowOverride ? v.replace('<row r="2">',rowOverride) : v)])));
}

describe("XLSX values-only import", () => {
  it("reads actual workbook sheets and cached values; uncached formula stays missing", async () => {
    const sheets = await parseXlsx(new File([new Uint8Array(workbook())], "hours.xlsx"));
    expect(sheets.map(s => s.name)).toEqual(["Hours", "Other"]);
    expect(sheets[0].parsed.rows).toEqual([["Jane Canary", "2026-10-01", "8"], ["Jane Canary", "2026-10-02", ""]]);
    const key = emptyNameKey();
    const items = mapRows("TIMESHEETS", sheets[0].parsed, suggestMapping("TIMESHEETS", sheets[0].parsed.headers), raw => codeFor(key, raw));
    expect(JSON.stringify(items)).not.toMatch(/Jane|EXECUTE|formula/);
    expect(validateRows("TIMESHEETS",items).rejected).toEqual([{ row: 3, field: "hours", code: "MISSING" }]);
  });
  it("reuses CSV row, column, cell and header boundaries and normalizes dates", () => {
    expect(sheetToCsv([["Date","Hours"],[new Date("2026-10-01T00:00:00Z"),8]])).toEqual({headers:["Date","Hours"],rows:[["2026-10-01","8"]]});
    expect(() => sheetToCsv([["Name","name"],["a","b"]])).toThrow(/headers/);
    expect(() => sheetToCsv([["Name"],["a".repeat(1001)]])).toThrow(/1,000|1000/);
    expect(() => sheetToCsv([Array(51).fill("a")])).toThrow(/columns/);
    expect(() => sheetToCsv([["Name"],...Array.from({length:10001},()=>["a"])])).toThrow(/rows/);
  });
  it("rejects oversize, malformed and unsupported files", async () => {
    await expect(parseXlsx(new File([new Uint8Array(5*1024*1024+1)],"a.xlsx"))).rejects.toThrow(/5 MB/);
    await expect(parseXlsx(new File(["bad"],"a.xlsx"))).rejects.toThrow(/archive/);
    await expect(parseXlsx(new File(["bad"],"a.xlsm"))).rejects.toThrow(/xlsx/i);
    await expect(parseXlsx(new File([new Uint8Array(workbook('<row r="1000000">'))],"a.xlsx"))).rejects.toThrow(/rows/);
  });
});
