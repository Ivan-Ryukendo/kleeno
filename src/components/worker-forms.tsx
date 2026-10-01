"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { postJson } from "@/lib/api";

const selectClass = "h-11 w-full rounded-full border border-primary/50 bg-white px-5 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40";
const amountPattern = "\\d+(\\.\\d{1,6})?";

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
        const r = await postJson("/api/workers", { pseudonym: f.get("pseudonym"), payType: f.get("payType"), baseAmount: f.get("baseAmount"), hourlyRate: f.get("hourlyRate") || "0" });
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
        <Button type="submit" disabled={busy} className="h-11 rounded-[1.25rem] px-6 text-base">
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
  active: boolean;
  leftOn: string | null;
  leftReason: string | null;
  history: { version: number; reason: string; base: string; hourly: string; at: string }[];
}

const label = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replaceAll("_", " ");
const hasHourly = (v: string) => Number(v) > 0;
const small = "h-9 rounded-[1.25rem] px-4";
const big = "h-11 rounded-[1.25rem] px-6 text-base";

/** One worker: the row, plus an inline panel to change pay (promotion), mark as left, reactivate, or see pay history. */
export function WorkerRow({ w, canEdit }: { w: WorkerView; canEdit: boolean }) {
  const router = useRouter();
  const [panel, setPanel] = useState<"pay" | "leave" | "history" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (p: "pay" | "leave" | "history") => {
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
        <td className="py-3 pr-4 font-medium">{w.pseudonym}</td>
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
            <span className="break-all font-mono text-xs">{w.walletAddress}</span>
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
            <Button type="button" variant="ghost" className={small} onClick={() => toggle("history")}>
              History ({w.history.length})
            </Button>
            {canEdit && w.active && (
              <>
                <Button type="button" variant="outline" className={small} onClick={() => toggle("pay")}>
                  Change pay
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
            {note && <p className="mb-3 text-sm">{note}</p>}
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
                className="grid gap-4 rounded-[1.25rem] bg-secondary p-5 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  run(`/api/workers/${w.id}/compensation`, { reason: f.get("reason"), payType: f.get("payType"), baseAmount: f.get("baseAmount"), hourlyRate: f.get("hourlyRate") || "0" }, () => "Saved. The new pay applies from the next calculation; approved runs do not change.");
                }}
              >
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
            {panel === "leave" && (
              <form
                className="grid gap-4 rounded-[1.25rem] bg-secondary p-5 sm:grid-cols-2"
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
