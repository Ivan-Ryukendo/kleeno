"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { CSV_LIMITS, IngestError, parseCsv, type ParsedCsv } from "@/core/ingest/csv";
import { mapRows, missingRequired, suggestMapping, type Mapping } from "@/core/ingest/map";
import { codeFor, emptyNameKey, NameKeyError, openNameKey, sealNameKey, WORKER_CODE } from "@/core/ingest/name-key";
import { FIELDS, validateRows, type ImportType, type Rejected, type RowItem } from "@/core/ingest/rows";
import { postJson } from "@/lib/api";

const select = "h-11 w-full rounded-full border border-primary/50 bg-white px-5 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40";
const big = "h-11 rounded-[1.25rem] px-6 text-base";
const TYPE_LABEL: Record<ImportType, string> = { TIMESHEETS: "Timesheets (hours worked)", LEAVE: "Leave (paid or unpaid)", ACTUAL_PAID: "Amounts actually paid (for the variance report)" };
const REJECT_TEXT: Record<string, string> = {
  MISSING: "a required value is missing",
  BAD_VALUE: "the value is not valid",
  CURRENCY: "not USD (only USD is supported)",
  UNKNOWN_WORKER: "that worker code is not set up yet",
  OUT_OF_PERIOD: "the date is outside the run's period",
};

export interface RunOption {
  id: string;
  label: string;
}
interface ServerResult {
  alreadyImported: boolean;
  rows: number;
  accepted: number;
  newRecords: number;
  rejected: Rejected[];
}
interface Prepared {
  items: RowItem[];
  localRejected: Rejected[];
  unknownCodes: string[];
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const RejectList = ({ rejected }: { rejected: Rejected[] }) => (
  <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-auto pl-5 text-sm">
    {rejected.slice(0, 100).map((r) => (
      <li key={`${r.row}-${r.field}`}>
        Line {r.row}, {r.field}: {REJECT_TEXT[r.code]}
      </li>
    ))}
    {rejected.length > 100 && <li>…and {rejected.length - 100} more</li>}
  </ul>
);

/** Parse, map and anonymise in the browser. Only mapped, typed fields are sent; names and the raw file never leave this computer (S25, rule 35). */
export function ImportWizard({ runs, workerCodes, nextCode }: { runs: RunOption[]; workerCodes: string[]; nextCode: number }) {
  const router = useRouter();
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const [type, setType] = useState<ImportType>("TIMESHEETS");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [keyFile, setKeyFile] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [result, setResult] = useState<ServerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPrepared(null);
    setResult(null);
    setError(null);
  };

  async function onFile(file: File | undefined) {
    reset();
    setParsed(null);
    if (!file) return;
    if (file.size > CSV_LIMITS.bytes) return setError("The file is larger than 5 MB.");
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const p = parseCsv(text);
      setParsed(p);
      setMapping(suggestMapping(type, p.headers));
    } catch (e) {
      setError(e instanceof IngestError ? e.message : "That file is not valid UTF-8 text. Save it as CSV (UTF-8) and try again.");
    }
  }

  async function prepare() {
    if (!parsed) return;
    reset();
    const missing = missingRequired(type, mapping);
    if (missing.length) return setError(`Choose a column for: ${missing.join(", ")}.`);
    setBusy(true);
    try {
      const col = mapping.workerRef;
      const usesNames = parsed.rows.some((r) => !WORKER_CODE.test((r[col] ?? "").trim().toUpperCase()));
      let key = emptyNameKey(nextCode);
      if (usesNames) {
        if (passphrase.length < 12) throw new NameKeyError("WEAK_PASSPHRASE");
        if (keyFile) key = await openNameKey(keyFile, passphrase);
      }
      const items = mapRows(type, parsed, mapping, (raw) => (WORKER_CODE.test(raw.toUpperCase()) ? raw.toUpperCase() : codeFor(key, raw)));
      if (usesNames) download("kleeno-name-key.json", await sealNameKey(key, passphrase)); // saved before anything is sent
      const { good, rejected } = validateRows(type, items);
      const codes = new Set(workerCodes);
      const unknownCodes = [...new Set(good.map((g) => (g.value as { workerRef: string }).workerRef))].filter((c) => !codes.has(c));
      setPrepared({ items, localRejected: rejected, unknownCodes });
    } catch (e) {
      setError(e instanceof NameKeyError ? e.message : "Could not prepare the file.");
    }
    setBusy(false);
  }

  async function send() {
    if (!prepared) return;
    setBusy(true);
    setError(null);
    const r = await postJson<ServerResult>("/api/imports", { runId, type, mapping, items: prepared.items });
    if (r.ok && r.data) {
      setResult(r.data);
      setPrepared(null);
      router.refresh();
    } else setError(r.error ?? "The import failed");
    setBusy(false);
  }

  if (runs.length === 0) return <p className="mt-6 text-muted-foreground">No run is open for data yet. Start one on the Dashboard first.</p>;

  const needsPassphrase = parsed && mapping.workerRef !== undefined && parsed.rows.some((r) => !WORKER_CODE.test((r[mapping.workerRef] ?? "").trim().toUpperCase()));
  return (
    <div className="mt-6 space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="run">Payroll run</Label>
          <select id="run" className={select} value={runId} onChange={(e) => (setRunId(e.target.value), reset())}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="type">What is in the file</Label>
          <select
            id="type"
            className={select}
            value={type}
            onChange={(e) => {
              const t = e.target.value as ImportType;
              setType(t);
              reset();
              if (parsed) setMapping(suggestMapping(t, parsed.headers));
            }}
          >
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="file">CSV file (UTF-8, up to 5 MB, 10,000 rows)</Label>
        <input id="file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="mt-2 block text-sm" />
        <p className="mt-2 text-sm text-muted-foreground">Amounts must be in USD. The file is read on this computer; only the columns you choose below are sent, and names are replaced by worker codes first.</p>
      </div>

      {parsed && (
        <>
          <div>
            <h3 className="text-lg">Which column is which?</h3>
            <p className="text-sm text-muted-foreground">{parsed.rows.length} rows. Leave optional ones unmapped to ignore them.</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {FIELDS[type].map((f) => (
                <div key={f.name}>
                  <Label htmlFor={`m-${f.name}`}>
                    {f.label}
                    {f.required ? " *" : ""}
                  </Label>
                  <select
                    id={`m-${f.name}`}
                    className={select}
                    value={mapping[f.name] ?? ""}
                    onChange={(e) => {
                      reset();
                      setMapping((m) => {
                        const next = { ...m };
                        if (e.target.value === "") delete next[f.name];
                        else next[f.name] = Number(e.target.value);
                        return next;
                      });
                    }}
                  >
                    <option value="">— not in this file —</option>
                    {parsed.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {needsPassphrase && (
            <div className="rounded-[1.25rem] border border-primary/50 p-5">
              <h3 className="text-lg">Names stay on this computer</h3>
              <p className="mt-1 text-sm text-muted-foreground">Names in your file become worker codes (W001…). A name key file remembers which code is whom so codes stay the same next time. It is encrypted with your passphrase and saved to your computer, never uploaded. Keep both safe: without them the codes cannot be matched back to names.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="keyfile">Existing name key file (if you have one)</Label>
                  <input id="keyfile" type="file" accept=".json,application/json" className="mt-2 block text-sm" onChange={async (e) => setKeyFile((await e.target.files?.[0]?.text()) ?? null)} />
                </div>
                <div>
                  <Label htmlFor="pass">Passphrase (at least 12 characters)</Label>
                  <Input id="pass" type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {!prepared && (
            <Button type="button" disabled={busy} className={big} onClick={prepare}>
              {busy ? "Preparing…" : "Check the file"}
            </Button>
          )}
        </>
      )}

      {prepared && (
        <div className="rounded-[1.25rem] border border-primary/50 p-5">
          <h3 className="text-lg">Ready to send</h3>
          <p className="mt-1 text-sm">
            {prepared.items.length - prepared.localRejected.length} of {prepared.items.length} rows look valid.
          </p>
          {prepared.unknownCodes.length > 0 && (
            <p className="mt-2 text-sm font-medium text-signal">
              Not set up as workers yet: {prepared.unknownCodes.join(", ")}. Add them on the Workers page first, or those rows will be rejected.
            </p>
          )}
          {prepared.localRejected.length > 0 && <RejectList rejected={prepared.localRejected} />}
          <Button type="button" disabled={busy} className={`mt-4 ${big}`} onClick={send}>
            {busy ? "Sending…" : "Send to Kleeno"}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-signal">
          {error}
        </p>
      )}

      {result && (
        <div role="status" className="rounded-[1.25rem] border border-primary/50 p-5">
          <h3 className="text-lg">{result.alreadyImported ? "Already imported" : "Imported"}</h3>
          <p className="mt-1 text-sm">
            {result.alreadyImported ? "This data was already in the run; nothing changed." : `${result.newRecords} new records stored from ${result.accepted} accepted rows (${result.rows} in the file).`}
          </p>
          {result.rejected.length > 0 && (
            <>
              <p className="mt-3 text-sm font-medium">{result.rejected.length} rows were rejected:</p>
              <RejectList rejected={result.rejected} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
