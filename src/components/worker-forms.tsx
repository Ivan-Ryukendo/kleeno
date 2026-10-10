"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { WorkerMetadata } from "@/core/workers";
import type { PayAdjustment } from "@/core/engine";
import { postJson } from "@/lib/api";
import { EffectiveCompensationForm } from "@/components/effective-compensation-form";

const selectClass = "h-(--field-height) w-full rounded-field border border-field-border bg-white px-(--field-px) text-(length:--field-text) leading-(--field-leading) outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40";
const amountPattern = "\\d+(\\.\\d{1,6})?";
const metadataFrom = (f: FormData): WorkerMetadata => ({ department: String(f.get("department") ?? "").trim() || null, jobTitle: String(f.get("jobTitle") ?? "").trim() || null, workerType: (f.get("workerType") || null) as WorkerMetadata["workerType"], tags: String(f.get("tags") ?? "").split(",").map(t => t.trim()).filter(Boolean), employmentStart: String(f.get("employmentStart") ?? "") || null, employmentEnd: String(f.get("employmentEnd") ?? "") || null });
function MetadataFields({ metadata, prefix }: { metadata?: WorkerMetadata; prefix: string }) {
  return <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2"><legend className="mb-3 text-sm font-medium">Worker evidence for policy scopes and part-period pay</legend>{(["department", "jobTitle", "tags"] as const).map(field => <div key={field}><Label htmlFor={`${prefix}-${field}`}>{field === "jobTitle" ? "Job title" : field === "tags" ? "Tags, separated by commas" : "Department"}</Label><Input id={`${prefix}-${field}`} name={field} maxLength={field === "tags" ? 820 : 80} defaultValue={field === "tags" ? metadata?.tags.join(", ") : metadata?.[field] ?? ""} /></div>)}<div><Label htmlFor={`${prefix}-workerType`}>Worker type</Label><select id={`${prefix}-workerType`} name="workerType" className={selectClass} defaultValue={metadata?.workerType ?? ""}><option value="">Not specified</option><option value="EMPLOYEE">Employee</option><option value="CONTRACTOR">Contractor</option></select></div>{(["employmentStart", "employmentEnd"] as const).map(field => <div key={field}><Label htmlFor={`${prefix}-${field}`}>{field === "employmentStart" ? "Employment start date" : "Employment end date (inclusive)"}</Label><Input id={`${prefix}-${field}`} name={field} type="date" defaultValue={metadata?.[field] ?? ""} /></div>)}<p className="text-sm text-muted-foreground sm:col-span-2">Use job and department labels, tags and worker codes. Keep real names in your local name key. Salaried and retainer pay use approved calendar-day proration.</p></fieldset>;
}

export function AddWorkerForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-6 grid gap-5 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setBusy(true);
        setError(null);
        const f = new FormData(form);
        const r = await postJson("/api/workers", { pseudonym: f.get("pseudonym"), payType: f.get("payType"), baseAmount: f.get("baseAmount"), hourlyRate: f.get("hourlyRate") || "0", metadata: metadataFrom(f) });
        if (r.ok) {
          form.reset();
          router.refresh();
        } else setError(r.error ?? "Could not add the worker");
        setBusy(false);
      }}
    >
      <div>
        <Label htmlFor="pseudonym">Worker code</Label>
        <Input id="pseudonym" name="pseudonym" placeholder="W001" pattern="W\d{3,}" title="W followed by 3 or more digits" required />
      </div>
      <div>
        <Label htmlFor="payType">Pay type</Label>
        <select id="payType" name="payType" className={selectClass} defaultValue="SALARIED">
          <option value="SALARIED">Salaried</option>
          <option value="HOURLY">Hourly</option>
          <option value="RETAINER">Retainer</option>
        </select>
      </div>
      <div>
        <Label htmlFor="baseAmount">Base or retainer per period (USDC)</Label>
        <Input id="baseAmount" name="baseAmount" inputMode="decimal" placeholder="2000.00" pattern={amountPattern} required />
      </div>
      <MetadataFields prefix="new-worker" />
      <div>
        <Label htmlFor="hourlyRate">Hourly rate (USDC, hourly or extra hours)</Label>
        <Input id="hourlyRate" name="hourlyRate" inputMode="decimal" placeholder="0" pattern={amountPattern} />
      </div>
      <div className="sm:col-span-2">
        {error && (
          <p role="alert" className="mb-3 text-sm font-medium text-signal">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="h-9 rounded-field px-4 text-sm">
          Add worker
        </Button>
      </div>
    </form>
  );
}

// Plain strings only: bigint amounts are formatted on the server before they cross into this client component.
export interface WorkerView {
  id: string;
  pseudonym: string;
  payType: string;
  base: string;
  hourly: string;
  walletAddress: string | null;
  walletConfirmed: boolean;
  active: boolean;
  leftOn: string | null;
  leftReason: string | null;
  history: { version: number; reason: string; base: string; hourly: string; at: string }[];
  metadata?: WorkerMetadata;
}

const label = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replaceAll("_", " ");
const hasHourly = (v: string) => Number(v) > 0;
const small = "h-8 rounded-field px-3 text-sm";
const big = "h-9 rounded-field px-4 text-sm";

/** One worker: the row, plus an inline panel to change pay (promotion), mark as left, reactivate, or see pay history. */
export function WorkerRow({ w, canEdit, canConfirm }: { w: WorkerView; canEdit: boolean; canConfirm: boolean }) {
  const router = useRouter();
  const [panel, setPanel] = useState<"pay" | "schedule" | "leave" | "history" | "wallet" | "metadata" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (p: "pay" | "schedule" | "leave" | "history" | "wallet" | "metadata") => {
    setPanel(panel === p ? null : p);
    setError(null);
  };
  async function run(url: string, body?: unknown, done?: (data: Record<string, unknown>) => string) {
    setBusy(true);
    setError(null);
    const r = await postJson(url, body);
    if (r.ok) {
      setNote(done ? done(r.data ?? {}) : null);
      setPanel(null);
      router.refresh();
    } else setError(r.error ?? "Something went wrong");
    setBusy(false);
  }
  const cancel = (
    <Button type="button" variant="ghost" className={big} onClick={() => setPanel(null)}>
      Cancel
    </Button>
  );

  return (
    <tbody className="border-t border-border align-top">
      <tr>
        <td className="py-3 pr-4"><span className="font-medium">{w.pseudonym}</span><p className="mt-1 text-xs text-muted-foreground">{[w.metadata?.department, w.metadata?.jobTitle].filter(Boolean).join(" · ")}</p></td>
        <td className="py-3 pr-4">
          <StatusPill status={w.payType} />
        </td>
        <td className="py-3 pr-4 text-right">{w.base}</td>
        <td className="py-3 pr-4 text-right">{hasHourly(w.hourly) ? w.hourly : "—"}</td>
        <td className="py-3 pr-4">
          {!w.active ? (
            <span className="text-muted-foreground">
              Left {w.leftOn} · {label(w.leftReason ?? "")}
            </span>
          ) : w.walletAddress ? (
            <span>
              <span className="break-all font-mono text-xs">{w.walletAddress}</span>
              {!w.walletConfirmed && <StatusPill status="NOT_CONFIRMED" className="ml-2 bg-signal text-white border-signal" />}
            </span>
          ) : canEdit ? (
            <Button type="button" variant="outline" disabled={busy} className={small} onClick={() => run(`/api/workers/${w.id}/wallet`)}>
              Create wallet
            </Button>
          ) : (
            <span className="text-muted-foreground">not created</span>
          )}
        </td>
        <td className="py-3 text-right">
          <div className="flex flex-wrap justify-end gap-2">
            {canEdit && <Button type="button" variant="outline" className={small} onClick={() => toggle("metadata")}>Worker details</Button>}
            <Button type="button" variant="ghost" className={small} onClick={() => toggle("history")}>
              History ({w.history.length})
            </Button>
            {(canEdit || (canConfirm && w.walletAddress && !w.walletConfirmed)) && w.active && (
              <Button type="button" variant="outline" className={small} onClick={() => toggle("wallet")}>
                {canConfirm && w.walletAddress && !w.walletConfirmed ? "Confirm wallet" : "Payout address"}
              </Button>
            )}
            {canEdit && w.active && (
              <>
                <Button type="button" variant="outline" className={small} onClick={() => toggle("pay")}>
                  Change pay
                </Button>
                <Button type="button" variant="outline" className="min-h-11 rounded-field px-3 text-sm" aria-expanded={panel === "schedule"} onClick={() => toggle("schedule")}>
                  Schedule pay
                </Button>
                <Button type="button" variant="outline" className={small} onClick={() => toggle("leave")}>
                  Mark as left
                </Button>
              </>
            )}
            {canEdit && !w.active && (
              <Button type="button" variant="outline" disabled={busy} className={small} onClick={() => run(`/api/workers/${w.id}/reactivate`, {}, () => "Reactivated. They are included in new runs again.")}>
                Reactivate
              </Button>
            )}
          </div>
        </td>
      </tr>
      {(panel || note || error) && (
        <tr>
          <td colSpan={6} className="pb-5">
            {panel === "schedule" && <><EffectiveCompensationForm workerId={w.id} workerCode={w.pseudonym} /><div className="mt-3">{cancel}</div></>}
            {note && <p className="mb-3 text-sm">{note}</p>}
            {panel === "metadata" && <form className="grid gap-4 rounded-box bg-secondary p-5 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); run(`/api/workers/${w.id}/metadata`, metadataFrom(new FormData(e.currentTarget)), () => "Worker details saved. Existing approved snapshots stay unchanged; new calculations use this evidence."); }}><MetadataFields prefix={w.id} metadata={w.metadata} /><div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={busy} className={big}>Save worker details</Button>{cancel}</div></form>}
            {panel === "history" && (
              <ul className="space-y-1 text-sm">
                {w.history.map((h) => (
                  <li key={h.version}>
                    <span className="font-medium">v{h.version}</span> · {label(h.reason)} · {h.base}
                    {hasHourly(h.hourly) ? ` + ${h.hourly}/h` : ""} · {h.at.slice(0, 10)}
                  </li>
                ))}
              </ul>
            )}
            {panel === "pay" && (
              <form
                className="grid gap-4 rounded-box bg-secondary p-5 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  run(`/api/workers/${w.id}/compensation`, { reason: f.get("reason"), payType: f.get("payType"), baseAmount: f.get("baseAmount"), hourlyRate: f.get("hourlyRate") || "0" }, () => "Saved. The new pay applies from the next calculation; approved runs do not change.");
                }}
              >
                <p className="text-sm text-muted-foreground sm:col-span-2">For an effective date or a worker with scheduled pay, use Schedule pay. Once a schedule exists, immediate pay changes are blocked to preserve its pinned baseline.</p>
                <div>
                  <Label htmlFor={`reason-${w.id}`}>Why</Label>
                  <select id={`reason-${w.id}`} name="reason" className={selectClass} defaultValue="PROMOTION">
                    <option value="PROMOTION">Promotion</option>
                    <option value="RAISE">Raise</option>
                    <option value="ROLE_CHANGE">Role change</option>
                    <option value="CORRECTION">Correction</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor={`type-${w.id}`}>Pay type</Label>
                  <select id={`type-${w.id}`} name="payType" className={selectClass} defaultValue={w.payType}>
                    <option value="SALARIED">Salaried</option>
                    <option value="HOURLY">Hourly</option>
                    <option value="RETAINER">Retainer</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor={`base-${w.id}`}>Base or retainer per period (USDC)</Label>
                  <Input id={`base-${w.id}`} name="baseAmount" inputMode="decimal" defaultValue={w.base} pattern={amountPattern} required />
                </div>
                <div>
                  <Label htmlFor={`hourly-${w.id}`}>Hourly rate (USDC)</Label>
                  <Input id={`hourly-${w.id}`} name="hourlyRate" inputMode="decimal" defaultValue={hasHourly(w.hourly) ? w.hourly : ""} placeholder="0" pattern={amountPattern} />
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="submit" disabled={busy} className={big}>
                    Save new pay
                  </Button>
                  {cancel}
                </div>
              </form>
            )}
            {panel === "wallet" && (
              <div className="space-y-4 rounded-box bg-secondary p-5">
                {canEdit && (
                  <form
                    className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      run(`/api/workers/${w.id}/recipient`, { address: f.get("address") }, () => "Saved. A payment approver has to confirm this address before it can be paid.");
                    }}
                  >
                    <div>
                      <Label htmlFor={`addr-${w.id}`}>External payout address (Arc testnet)</Label>
                      <Input id={`addr-${w.id}`} name="address" placeholder="0x…" pattern="0x[0-9a-fA-F]{40}" required />
                    </div>
                    <Button type="submit" disabled={busy} className={big}>
                      Propose address
                    </Button>
                  </form>
                )}
                {canConfirm && w.walletAddress && !w.walletConfirmed && (
                  <form
                    className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      run(`/api/workers/${w.id}/recipient/confirm`, { password: f.get("password") }, () => "Confirmed. This address can now be paid.");
                    }}
                  >
                    <div>
                      <p className="mb-2 text-sm">
                        Confirm <span className="break-all font-mono text-xs">{w.walletAddress}</span> as the only address {w.pseudonym} is paid at. The person who set it cannot confirm it.
                      </p>
                      <Label htmlFor={`confirm-${w.id}`}>Your password</Label>
                      <Input id={`confirm-${w.id}`} name="password" type="password" autoComplete="current-password" required />
                    </div>
                    <Button type="submit" disabled={busy} className={big}>
                      Confirm address
                    </Button>
                  </form>
                )}
                <Button type="button" variant="ghost" className={big} onClick={() => setPanel(null)}>
                  Close
                </Button>
              </div>
            )}
            {panel === "leave" && (
              <form
                className="grid gap-4 rounded-box bg-secondary p-5 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  run(`/api/workers/${w.id}/archive`, { leftOn: f.get("leftOn"), reason: f.get("reason") }, (d) => {
                    const n = Number(d.openObligations ?? 0);
                    return n > 0 ? `Marked as left. ${n} unpaid payment(s) stay in place so final pay can still go out.` : "Marked as left. They are skipped in new runs; their history is kept.";
                  });
                }}
              >
                <div>
                  <Label htmlFor={`left-${w.id}`}>Last day</Label>
                  <Input id={`left-${w.id}`} name="leftOn" type="date" required />
                </div>
                <div>
                  <Label htmlFor={`why-${w.id}`}>Reason</Label>
                  <select id={`why-${w.id}`} name="reason" className={selectClass} defaultValue="RESIGNED">
                    <option value="RESIGNED">Resigned</option>
                    <option value="TERMINATED">Terminated</option>
                    <option value="CONTRACT_ENDED">Contract ended</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <p className="text-sm text-muted-foreground sm:col-span-2">Workers are archived, not deleted: past runs, payments and the audit trail keep pointing at them. You can reactivate later.</p>
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="submit" disabled={busy} className={big}>
                    Mark as left
                  </Button>
                  {cancel}
                </div>
              </form>
            )}
            {error && (
              <p role="alert" className="mt-3 text-sm font-medium text-signal">
                {error}
              </p>
            )}
          </td>
        </tr>
      )}
    </tbody>
  );
}

/** HR amounts remain editable only until calculation. The server independently enforces that boundary. */
export function RunAdjustmentsForm({ runId, workers, initial = {} }: { runId: string; workers: { id: string; pseudonym: string }[]; initial?: Record<string, PayAdjustment[]> }) {
  const router = useRouter();
  const [workerId, setWorkerId] = useState(workers[0]?.id ?? "");
  const [rows, setRows] = useState<PayAdjustment[]>(initial[workers[0]?.id ?? ""] ?? []);
  const [drafts, setDrafts] = useState<Record<string, PayAdjustment[]>>(initial);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const update = (id: string, field: "kind" | "amount" | "reason", value: string) => { setSaved(false); setRows(v => v.map(r => r.id === id ? { ...r, [field]: value } as PayAdjustment : r)); };
  return <form className="panel mt-6 space-y-4" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(null); setSaved(false); const result = await postJson(`/api/runs/${runId}/adjustments`, { workerId, adjustments: rows }); if (result.ok) { setSaved(true); router.refresh(); } else setError(result.error ?? "Could not save pay adjustments"); setBusy(false); }}>
    <div><h2 className="text-lg">Pay additions and fixed deductions</h2><p className="mt-2 text-sm text-muted-foreground">HR enters each amount and reason. They become part of the immutable calculation and its hash; calculate after saving. To change calculated inputs, create a new run.</p></div>
    <div className="max-w-sm"><Label htmlFor={`adjust-worker-${runId}`}>Worker</Label><select id={`adjust-worker-${runId}`} className={selectClass} value={workerId} disabled={busy} onChange={e => { setDrafts(v => ({ ...v, [workerId]: rows })); setWorkerId(e.target.value); setRows(drafts[e.target.value] ?? []); setSaved(false); setError(null); }}>{workers.map(w => <option key={w.id} value={w.id}>{w.pseudonym}</option>)}</select></div>
    {rows.length === 0 && <p className="text-sm text-muted-foreground">No additions or fixed deductions for this worker.</p>}
    {rows.map((row, index) => <fieldset key={row.id} disabled={busy} className="grid gap-3 rounded-box border border-border p-4 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">Adjustment {index + 1}</legend><div><Label htmlFor={`kind-${row.id}`}>Kind</Label><select id={`kind-${row.id}`} className={selectClass} value={row.kind} onChange={e => update(row.id, "kind", e.target.value)}><option value="BONUS">Bonus</option><option value="COMMISSION">Commission</option><option value="REIMBURSEMENT">Reimbursement</option><option value="FIXED_DEDUCTION">Fixed deduction</option></select></div><div><Label htmlFor={`amount-${row.id}`}>Amount (USDC)</Label><Input id={`amount-${row.id}`} inputMode="decimal" pattern={amountPattern} maxLength={30} value={row.amount} onChange={e => update(row.id, "amount", e.target.value)} required /></div><div className="sm:col-span-2"><Label htmlFor={`reason-${row.id}`}>Reason</Label><Input id={`reason-${row.id}`} value={row.reason} maxLength={300} onChange={e => update(row.id, "reason", e.target.value)} required /></div><div className="sm:col-span-2"><Button type="button" variant="ghost" className={small} onClick={() => { setRows(v => v.filter(r => r.id !== row.id)); setSaved(false); }}>Remove adjustment {index + 1}</Button></div></fieldset>)}
    <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={busy || rows.length >= 50 || !workerId} className={big} onClick={() => { setRows(v => [...v, { id: crypto.randomUUID(), kind: "BONUS", amount: "", reason: "" }]); setSaved(false); }}>Add adjustment</Button><Button type="submit" disabled={busy || !workerId} className={big}>{busy ? "Saving…" : "Save this worker’s adjustments"}</Button></div>
    {saved && <p role="status" className="text-sm">Saved. Calculate this run to review the new totals and trace.</p>}{error && <p role="alert" className="text-sm text-signal">{error}</p>}
  </form>;
}
