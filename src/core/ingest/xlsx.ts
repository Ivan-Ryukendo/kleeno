import { CSV_LIMITS, IngestError, parseCsv, type ParsedCsv } from "./csv";
import { DocumentError, POLICY_LIMITS, unzipBounded } from "./documents";

export interface ImportSheet { name: string; parsed: ParsedCsv }
export function sheetToCsv(rows: readonly (readonly unknown[])[]): ParsedCsv {
  if (rows.length > CSV_LIMITS.rows + 1) throw new IngestError("TOO_MANY_ROWS", "The sheet has more than 10,000 rows.");
  if (rows.some(r => r.length > CSV_LIMITS.columns)) throw new IngestError("TOO_MANY_COLUMNS", "The sheet has more than 50 columns.");
  const width = Math.max(0, ...rows.map(r => r.length));
  const csv = rows.map(row => Array.from({ length: width }, (_, i) => {
    const value = row[i];
    const text = value instanceof Date ? value.toISOString().slice(0,10) : value == null ? "" : String(value);
    if (text.length > CSV_LIMITS.cellChars) throw new IngestError("CELL_TOO_LONG", "A cell is longer than 1,000 characters.");
    return `"${text.replaceAll('"','""')}"`;
  }).join(",")).join("\n");
  return parseCsv(csv);
}

export async function parseXlsx(file: File, signal?: AbortSignal): Promise<ImportSheet[]> {
  if (file.size > CSV_LIMITS.bytes) throw new IngestError("TOO_LARGE", "The file is larger than 5 MB.");
  if (!/\.xlsx$/i.test(file.name)) throw new DocumentError("Choose an .xlsx workbook; macro-enabled and legacy Excel files are unsupported.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipBounded(bytes, POLICY_LIMITS, signal);
  // Preflight decoded XML limits before the library allocates sparse sheet matrices or shared-string arrays.
  for (const [name, content] of Object.entries(entries)) if (name.endsWith(".xml")) {
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(content);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new DocumentError("The workbook XML is unsafe.");
    if (/^xl\/worksheets\//.test(name)) {
      if ((xml.match(/<(?:[\w.-]+:)?row(?:\s|>)/g)?.length ?? 0) > CSV_LIMITS.rows + 1) throw new IngestError("TOO_MANY_ROWS", "The sheet has more than 10,000 rows.");
      for (const match of xml.matchAll(/<(?:[\w.-]+:)?row\b[^>]*\br=["'](\d+)["']/g)) if (Number(match[1]) > CSV_LIMITS.rows + 1) throw new IngestError("TOO_MANY_ROWS", "The sheet has more than 10,000 rows.");
      for (const match of xml.matchAll(/\br=["']([a-z]+)(\d+)["']/gi)) {
        let column = 0; for (const c of match[1].toUpperCase()) column = column * 26 + c.charCodeAt(0) - 64;
        if (column > CSV_LIMITS.columns) throw new IngestError("TOO_MANY_COLUMNS", "The sheet has more than 50 columns.");
        if (Number(match[2]) > CSV_LIMITS.rows + 1) throw new IngestError("TOO_MANY_ROWS", "The sheet has more than 10,000 rows.");
      }
    }
  }
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  try {
    // Universal is the maintained non-worker browser API; it reads stored/cached values without evaluating formulas.
    const { default: readWorkbook } = await import("read-excel-file/universal");
    const sheets = await readWorkbook(bytes.buffer);
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return sheets.map(sheet => ({ name: sheet.sheet, parsed: sheetToCsv(sheet.data) }));
  } catch (e) {
    if (e instanceof IngestError || e instanceof DOMException) throw e;
    throw new DocumentError("The workbook could not be read. Save it as .xlsx or CSV (UTF-8) and try again.");
  }
}
