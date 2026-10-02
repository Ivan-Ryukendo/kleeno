"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { describeFacts, type ReconCategory, type ResolutionAction } from "@/core/reconciliation";
import { postJson } from "@/lib/api";

const big = "h-11 rounded-[1.25rem] px-6 text-base";
const select = "h-11 w-full rounded-full border border-primary/50 bg-white px-5 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40";

export const CATEGORY_LABEL: Record<ReconCategory, string> = {
  DUPLICATE_TIMESHEET: "Duplicate timesheet lines",
  LEAVE_WORK_CONFLICT: "Leave and work on the same day",
  UNAPPROVED_OVERTIME: "Hours above the limit without approval",
  UNEXPLAINED_MISSING_HOURS: "Unexplained missing hours",
};

const ACTION_LABEL: Record<ResolutionAction, string> = {
  KEEP_FIRST: "Keep the first line",
  KEEP_LATEST: "Keep the latest line",
  KEEP_ALL: "Keep all lines (separate shifts)",
  KEEP_WORK: "Keep the work, drop the leave",
  KEEP_LEAVE: "Keep the leave, drop the work",
  KEEP_BOTH: "Keep both (they fit in one day)",
  APPROVE_HOURS: "Approve these hours (they are paid)",
  EXCLUDE_HOURS: "Do not pay these hours",
  TREAT_AS_PAID_LEAVE: "Treat as paid leave (no deduction)",
  TREAT_AS_UNPAID_LEAVE: "Treat as unpaid leave (deducts pay)",
};

export interface ExceptionRow {
  id: string;
  worker: string;
  category: ReconCategory;
  status: string;
  facts: Record<string, string>;
  recordCount: number;
  options: ResolutionAction[];
  suggestion: { action: ResolutionAction; confidence: string } | null;
  decision: ResolutionAction | null;
  note: string | null;
}

export function RunChecksButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4">
      <Button
        type="button"
        disabled={busy}
        className={big}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await postJson(`/api/runs/${runId}/reconcile`);
          if (r.ok) router.refresh();
          else setError(r.error ?? "The checks failed");
          setBusy(false);
        }}
      >
        {busy ? "Checking…" : "Run the checks"}
      </Button>
      <p className="mt-2 text-sm text-muted-foreground">This closes the run to new data. An AI reviewer then adds a suggestion to each finding; it never decides.</p>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-signal">
          {error}
        </p>
      )}
    </div>
  );
}

/** One category: select several open items to settle them with one decision and one note (S60), or settle one at a time. */
export function CategoryPanel({ runId, category, rows, canEdit }: { runId: string; category: ReconCategory; rows: ExceptionRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<string>("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = rows.filter((r) => r.status !== "RESOLVED");
  const chosen = open.filter((r) => picked.has(r.id));
  const shared = chosen.length ? chosen.map((r) => r.options).reduce((a, b) => a.filter((x) => b.includes(x))) : [];

  async function send(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    const r = await postJson(url, body);
    if (r.ok) {
      setPicked(new Set());
      setNote("");
      router.refresh();
    } else setError(r.error ?? "Could not save the decision");
    setBusy(false);
  }

  return (
    <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
      <h2 className="text-2xl">
        <span className="mr-3 inline-block size-2 rounded-full bg-signal align-middle" />
        {CATEGORY_LABEL[category]} <span className="text-muted-foreground">({open.length} open of {rows.length})</span>
      </h2>

      <ul className="mt-6 divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-4 py-4">
            {canEdit && r.status !== "RESOLVED" ? <input type="checkbox" aria-label={`Select ${r.worker}`} checked={picked.has(r.id)} onChange={(e) => setPicked((p) => (e.target.checked ? new Set(p).add(r.id) : (p.delete(r.id), new Set(p))))} className="mt-1 size-4" /> : <span className="w-4" />}
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {r.worker} <StatusPill status={r.status} className="ml-2" />
              </p>
              <p className="mt-1 text-sm">{describeFacts(category, r.facts)}</p>
              <p className="mt-1 text-sm text-muted-foreground">Evidence: {r.recordCount} imported records.</p>
              {r.suggestion && r.status !== "RESOLVED" && (
                <p className="mt-2 text-sm">
                  <span className="rounded-full bg-secondary px-3 py-1">Suggested by AI, not applied: {ACTION_LABEL[r.suggestion.action]} ({r.suggestion.confidence.toLowerCase()} confidence)</span>
                </p>
              )}
              {r.status === "RESOLVED" && r.decision && (
                <p className="mt-2 text-sm">
                  Decision: <span className="font-medium">{ACTION_LABEL[r.decision]}</span>
                  {r.note ? ` · ${r.note}` : ""}
                </p>
              )}
            </div>
            {canEdit && r.status !== "RESOLVED" && <SingleDecision row={r} busy={busy} onSave={(a, n) => send(`/api/exceptions/${r.id}`, { action: a, note: n })} />}
          </li>
        ))}
      </ul>

      {canEdit && chosen.length > 1 && (
        <div className="mt-6 rounded-[1.25rem] border border-primary/50 p-5">
          <h3 className="text-lg">Settle {chosen.length} selected together</h3>
          {shared.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">These items have no decision in common. Select items that accept the same decision.</p>
          ) : (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor={`bulk-${category}`}>Decision for all</Label>
                <select id={`bulk-${category}`} className={select} value={action} onChange={(e) => setAction(e.target.value)}>
                  <option value="">Choose…</option>
                  {shared.map((a) => (
                    <option key={a} value={a}>
                      {ACTION_LABEL[a]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor={`bulk-note-${category}`}>Note (required, no names)</Label>
                <Input id={`bulk-note-${category}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </div>
            </div>
          )}
          {shared.length > 0 && (
            <Button type="button" disabled={busy || !action || note.trim().length < 3} className={`mt-4 ${big}`} onClick={() => send("/api/exceptions/bulk", { runId, category, ids: chosen.map((r) => r.id), action, note })}>
              Settle {chosen.length}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-signal">
          {error}
        </p>
      )}
    </section>
  );
}

function SingleDecision({ row, busy, onSave }: { row: ExceptionRow; busy: boolean; onSave: (action: string, note: string) => void }) {
  const [action, setAction] = useState<string>(row.suggestion?.action ?? "");
  const [note, setNote] = useState("");
  return (
    <div className="grid w-full gap-3 sm:w-96">
      <select aria-label={`Decision for ${row.worker}`} className={select} value={action} onChange={(e) => setAction(e.target.value)}>
        <option value="">Choose a decision…</option>
        {row.options.map((a) => (
          <option key={a} value={a}>
            {ACTION_LABEL[a]}
          </option>
        ))}
      </select>
      <Input aria-label={`Note for ${row.worker}`} placeholder="Why (required, no names)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      <Button type="button" disabled={busy || !action || note.trim().length < 3} className="h-11 rounded-[1.25rem] px-6 text-base" onClick={() => onSave(action, note)}>
        Save decision
      </Button>
    </div>
  );
}
