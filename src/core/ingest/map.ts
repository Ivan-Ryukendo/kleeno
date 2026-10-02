import type { ParsedCsv } from "./csv";
import { FIELDS, type ImportType, type RowItem } from "./rows";

// Browser-side mapping: column choice -> typed fields. Only mapped columns ever leave the browser (S25); the worker column
// becomes a W-code through `resolveWorker` (rule 35). Values are normalised, never invented: anything unclear stays as
// typed and is rejected by validation with its row number.
export type Mapping = Record<string, number>; // field name -> column index

const SYNONYMS: Record<string, RegExp> = {
  workerRef: /^(worker|employee|staff|contractor|person|name|full ?name|employee ?(id|name|code)|worker ?(id|code|name))$/i,
  date: /^(date|day|work ?date|leave ?date)$/i,
  hours: /^(hours?|hrs|hours ?worked|worked ?hours|total ?hours)$/i,
  approvedExtraHours: /^(approved ?(extra|overtime|ot)( ?hours?)?|overtime ?approved|approved ?hours)$/i,
  leaveType: /^(leave ?type|type|kind)$/i,
  amount: /^(amount|paid|amount ?paid|net ?pay|net|total ?paid|payment)$/i,
  currency: /^(currency|ccy)$/i,
};

export function suggestMapping(type: ImportType, headers: string[]): Mapping {
  const out: Mapping = {};
  for (const f of FIELDS[type]) {
    const i = headers.findIndex((h, idx) => SYNONYMS[f.name]?.test(h.trim()) && !Object.values(out).includes(idx));
    if (i >= 0) out[f.name] = i;
  }
  return out;
}

export const missingRequired = (type: ImportType, mapping: Mapping) => FIELDS[type].filter((f) => f.required && mapping[f.name] === undefined).map((f) => f.label);

/** ISO (2026-10-01) or US (10/1/2026). Anything else is returned unchanged and fails validation. */
export function normalizeDate(raw: string): string {
  const v = raw.trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : v;
}

export function mapRows(type: ImportType, parsed: ParsedCsv, mapping: Mapping, resolveWorker: (raw: string) => string | null): RowItem[] {
  return parsed.rows.map((cells, i) => {
    const data: Record<string, string> = {};
    for (const f of FIELDS[type]) {
      const col = mapping[f.name];
      if (col === undefined) continue;
      const raw = (cells[col] ?? "").trim();
      if (f.name === "workerRef") data.workerRef = resolveWorker(raw) ?? "";
      else if (f.name === "date") data.date = normalizeDate(raw);
      else if (f.name === "leaveType" || f.name === "currency") data[f.name] = raw.toUpperCase();
      else if (f.name === "amount") data.amount = raw.replace(/^\$/, "").replace(/,/g, "");
      else if (raw !== "" || f.required) data[f.name] = raw;
    }
    return { row: i + 2, data };
  });
}
