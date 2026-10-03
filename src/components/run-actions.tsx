"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { postJson } from "@/lib/api";

const big = "h-9 rounded-field px-4 text-sm";

function Alert({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-3 text-sm font-medium text-signal">
      {error}
    </p>
  ) : null;
}

/** Calls one run route that needs no body and refreshes the page. */
function ActionButton({ url, label, busyLabel, variant = "default" }: { url: string; label: string; busyLabel: string; variant?: "default" | "outline" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4">
      <Button
        type="button"
        variant={variant}
        disabled={busy}
        className={big}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await postJson(url);
          if (r.ok) router.refresh();
          else setError(r.error ?? "That did not work");
          setBusy(false);
        }}
      >
        {busy ? busyLabel : label}
      </Button>
      <Alert error={error} />
    </div>
  );
}

/** Runs the deterministic engine on the reconciled data. The server refuses unless every exception is resolved. */
export function CalculateButton({ runId }: { runId: string }) {
  return <ActionButton url={`/api/runs/${runId}/calculate`} label="Calculate pay" busyLabel="Calculating…" />;
}

/** Sends a calculated LIVE run to the approver. Nothing is paid by this. */
export function SubmitForApprovalButton({ runId }: { runId: string }) {
  return <ActionButton url={`/api/runs/${runId}/submit`} label="Send for approval" busyLabel="Sending…" />;
}

/** Finishes obligations of an approved run after a wallet was fixed or confirmed (no new authority, so no password). */
export function ResumeObligationsButton({ runId }: { runId: string }) {
  return <ActionButton url={`/api/runs/${runId}/obligations`} label="Create the payment obligations" busyLabel="Creating…" variant="outline" />;
}

/**
 * Payroll approval (S16): shows what is being approved, asks for the password again, and the server binds the calculation hash.
 * The approver cannot also sign the payment plan later (four-eyes).
 */
export function ApproveRunForm({ runId, total, count, calculationHash }: { runId: string; total: string; count: number; calculationHash: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-4 max-w-xl space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        const r = await postJson(`/api/runs/${runId}/approve`, { password: f.get("password") });
        if (r.ok) router.refresh();
        else setError(r.error ?? "Approval failed");
        setBusy(false);
      }}
    >
      <p>
        You are approving <strong>{count} payments totalling {total} USDC</strong> on Arc testnet (test USDC, no real funds). The approval is bound to calculation <span className="break-all font-mono text-xs">{calculationHash}</span>. A different person signs the payment plan.
      </p>
      <div>
        <Label htmlFor="approve-password">Your password</Label>
        <Input id="approve-password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy} className={big}>
          {busy ? "Approving…" : "Approve payroll"}
        </Button>
        <RejectButton runId={runId} />
      </div>
      <Alert error={error} />
    </form>
  );
}

function RejectButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      className={big}
      onClick={async () => {
        if (!window.confirm("Reject this run? A rejected run is final; start a new run to pay.")) return;
        setBusy(true);
        const r = await postJson(`/api/runs/${runId}/reject`);
        if (r.ok) router.refresh();
        setBusy(false);
      }}
    >
      Reject
    </Button>
  );
}
