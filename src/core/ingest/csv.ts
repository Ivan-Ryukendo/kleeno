// Safe CSV parser (S25). Runs in the browser for UX and again on the server for security. Cells are plain strings:
// nothing is evaluated, so "=SUM(...)" is just text. Errors name rows and limits, never cell contents.
export const CSV_LIMITS = { bytes: 5 * 1024 * 1024, rows: 10_000, columns: 50, cellChars: 1_000 } as const;

export class IngestError extends Error {
  constructor(
    readonly code: "TOO_LARGE" | "TOO_MANY_ROWS" | "TOO_MANY_COLUMNS" | "CELL_TOO_LONG" | "NOT_UTF8" | "BAD_HEADERS" | "MALFORMED" | "EMPTY",
    message: string,
    readonly rows: number[] = [],
  ) {
    super(message);
  }
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

function detectDelimiter(firstLine: string) {
  const count = (c: string) => firstLine.split(c).length;
  return [",", ";", "\t"].reduce((best, c) => (count(c) > count(best) ? c : best), ",");
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (text.includes("�")) throw new IngestError("NOT_UTF8", "The file is not valid UTF-8. Save it as CSV (UTF-8) and try again.");
  if (new TextEncoder().encode(text).length > CSV_LIMITS.bytes) throw new IngestError("TOO_LARGE", "The file is larger than 5 MB.");
  if (!text.trim()) throw new IngestError("EMPTY", "The file is empty.");

  const delimiter = detectDelimiter(text.split(/\r?\n/, 1)[0]);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    if (cell.length > CSV_LIMITS.cellChars) throw new IngestError("CELL_TOO_LONG", `A cell on row ${records.length + 1} is longer than ${CSV_LIMITS.cellChars} characters.`, [records.length + 1]);
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.length > CSV_LIMITS.columns) throw new IngestError("TOO_MANY_COLUMNS", `The file has more than ${CSV_LIMITS.columns} columns.`);
    if (!(row.length === 1 && row[0] === "")) records.push(row); // skip blank lines
    if (records.length > CSV_LIMITS.rows + 1) throw new IngestError("TOO_MANY_ROWS", `The file has more than ${CSV_LIMITS.rows} rows. Split it by period.`);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (quoted) throw new IngestError("MALFORMED", "A quoted cell is never closed.");
  if (cell !== "" || row.length) endRow();

  const [headerRow, ...rows] = records;
  const headers = headerRow.map((h) => h.trim());
  if (headers.some((h) => h === "") || new Set(headers.map((h) => h.toLowerCase())).size !== headers.length) throw new IngestError("BAD_HEADERS", "Column headers must be present and unique.");
  const bad = rows.flatMap((r, i) => (r.length === headers.length ? [] : [i + 2])); // +2: header is row 1
  if (bad.length) throw new IngestError("MALFORMED", `Rows with the wrong number of columns: ${bad.slice(0, 20).join(", ")}${bad.length > 20 ? "…" : ""}.`, bad);
  return { headers, rows };
}

/** Spreadsheet-injection guard for exports (S25): cells starting with = + - @ tab or CR are prefixed with a quote. */
export const escapeCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
