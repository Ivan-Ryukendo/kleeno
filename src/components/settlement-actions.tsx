"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { formatUsdc } from "@/core/money";
import { postJson } from "@/lib/api";

const big = "h-9 rounded-field px-4 text-sm";

function Alert({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-3 text-sm font-medium text-signal">
      {error}
    </p>
  ) : null;
}

interface StandingAuthorizationRow {
  id: string;
  max_batch_total: string | number;
  max_per_payment: string | number;
  expires_at: string;
  revoked_at: string | null;
}

/** A payment approver can grant a capped, expiring clean-plan authorization and revoke it at any time. */
export function StandingAuthorizationsPanel({ canCreate, initialRows }: { canCreate: boolean; initialRows: StandingAuthorizationRow[] }) {
  const [rows, setRows] = useState<StandingAuthorizationRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const response = await fetch("/api/standing-authorizations", { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json?.error?.message ?? "Could not load standing authorizations");
        return;
      }
      setRows(json as StandingAuthorizationRow[]);
    } catch {
      setError("Could not reach the server");
    }
  }

  return (
    <div className="mt-4 space-y-5">
      <p className="text-sm text-muted-foreground">A standing authorization may sign only an accepted, clean payment plan within these limits. Holds, flags, changed policy or recipients, and missing evidence always require a person.</p>
      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-field border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="text-sm">
                <p><strong>{formatUsdc(BigInt(row.max_batch_total))} USDC</strong> per batch · {formatUsdc(BigInt(row.max_per_payment))} USDC per payment</p>
                <p className="mt-1 text-muted-foreground">Expires {new Date(row.expires_at).toLocaleString()}{row.revoked_at ? " · Revoked" : ""}</p>
              </div>
              {!row.revoked_at && (
                <Button type="button" variant="outline" className={big} disabled={busy} onClick={async () => {
                  setBusy(true); setError(null);
                  const result = await postJson("/api/standing-authorizations", { action: "revoke", id: row.id });
                  if (result.ok) await refresh(); else setError(result.error ?? "Could not revoke the authorization");
                  setBusy(false);
                }}>Revoke</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canCreate ? (
        <form className="grid max-w-3xl gap-4 sm:grid-cols-2" onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const values = new FormData(form);
          setBusy(true); setError(null);
          const result = await postJson("/api/standing-authorizations", {
            action: "create",
            maxBatchTotal: values.get("maxBatchTotal"),
            maxPerPayment: values.get("maxPerPayment"),
            expiresAt: new Date(String(values.get("expiresAt"))).toISOString(),
            password: values.get("password"),
          });
          if (result.ok) { form.reset(); await refresh(); }
          else setError(result.error ?? "Could not create the authorization");
          setBusy(false);
        }}>
          <p className="sm:col-span-2 text-sm">Set explicit USDC limits and an expiry. Creating or changing a grant requires your password.</p>
          <div><Label htmlFor="standing-batch">Maximum batch total (USDC)</Label><Input id="standing-batch" name="maxBatchTotal" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" placeholder="1000" required /></div>
          <div><Label htmlFor="standing-payment">Maximum per payment (USDC)</Label><Input id="standing-payment" name="maxPerPayment" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" placeholder="250" required /></div>
          <div><Label htmlFor="standing-expiry">Expiry</Label><Input id="standing-expiry" name="expiresAt" type="datetime-local" required /></div>
          <div><Label htmlFor="standing-password">Your password</Label><Input id="standing-password" name="password" type="password" autoComplete="current-password" required /></div>
          <div className="sm:col-span-2"><Button type="submit" disabled={busy} className={big}>{busy ? "Saving…" : "Create standing authorization"}</Button></div>
        </form>
      ) : <p className="text-sm text-muted-foreground">Live payments are off; existing authorizations can still be revoked.</p>}
      <Alert error={error} />
    </div>
  );
}

interface ExecResult {
  status: "OPEN" | "COMPLETED";
  settled: number;
  failed: number;
  remaining: number;
  inFlight: number;
}

/** The executor stops after ~40 s and says what is left; keep calling it until nothing remains (it never pays around the gate). */
async function payAll(batchId: string, progress: (text: string) => void): Promise<string | null> {
  for (let i = 0; i < 20; i++) {
    const r = await postJson<ExecResult>(`/api/batches/${batchId}/execute`);
    if (!r.ok || !r.data) return r.error ?? "Payment stopped";
    const d = r.data;
    progress(`${d.settled} paid in this step, ${d.remaining} waiting${d.inFlight ? `, ${d.inFlight} confirming on Arc` : ""}`);
    if (d.status === "COMPLETED" || d.remaining === 0) return null;
  }
  return null;
}

/** Choose what to hold back, then build the plan. Code builds it (no AI in P4); a hold only reduces authority, so no password here. */
export function PlanForm({ runId, rows, hasProposal }: { runId: string; rows: { id: string; worker: string; amount: string; held: boolean }[]; hasProposal: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const holdIds = new FormData(e.currentTarget).getAll("hold").map(String);
        setBusy(true);
        setError(null);
        const r = await postJson(`/api/runs/${runId}/plan`, { holdIds });
        if (r.ok) router.refresh();
        else setError(r.error ?? "Could not build the plan");
        setBusy(false);
      }}
    >
      <p className="text-sm text-muted-foreground">Tick a payment to hold it back. A held payment is not paid until you sign a new plan that releases it.</p>
      <ul className="mt-4 divide-y divide-border">
        {rows.map((o) => (
          <li key={o.id}>
            <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
              <span className="flex items-center gap-3">
                <input type="checkbox" name="hold" value={o.id} defaultChecked={o.held} className="size-5 accent-[var(--primary)]" />
                <span className="font-medium">{o.worker}</span>
              </span>
              <span>{o.amount} USDC</span>
            </label>
          </li>
        ))}
      </ul>
      <Button type="submit" disabled={busy} className={`${big} mt-5`}>
        {busy ? "Building…" : hasProposal ? "Rebuild the plan" : "Build the plan"}
      </Button>
      <Alert error={error} />
    </form>
  );
}

/** Plan signing (S16): shows exactly what will be committed, asks for the password, then pays the batch. */
export function SignForm({ batchId, total, count, held }: { batchId: string; total: string; count: number; held: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  return (
    <form
      className="mt-6 max-w-xl space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        setStep("Signing and opening the run on Arc…");
        const s = await postJson(`/api/batches/${batchId}/sign`, { password: f.get("password") });
        if (!s.ok) {
          setError(s.error ?? "Signing failed");
          setStep(null);
        } else {
          setStep("Paying…");
          const err = await payAll(batchId, setStep);
          if (err) setError(err);
          setStep(null);
        }
        setBusy(false);
        router.refresh();
      }}
    >
      <p>
        You are signing <strong>{count} payments totalling {total} USDC</strong> from the company approver wallet on Arc testnet (test USDC, no real funds)
        {held > 0 ? `, with ${held} held back` : ""}. After signing, the contract can pay only these amounts to these wallets, once.
      </p>
      <div>
        <Label htmlFor="sign-password">Your password</Label>
        <Input id="sign-password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy} className={big}>
          {busy ? "Working…" : "Sign and pay"}
        </Button>
        <DiscardButton batchId={batchId} disabled={busy} />
      </div>
      {step && <p role="status" className="text-sm">{step}</p>}
      <Alert error={error} />
    </form>
  );
}

function DiscardButton({ batchId, disabled }: { batchId: string; disabled: boolean }) {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      className={big}
      onClick={async () => {
        await postJson(`/api/batches/${batchId}/discard`);
        router.refresh();
      }}
    >
      Discard plan
    </Button>
  );
}

/** For a signed batch that is not finished: continue paying, finish anything stuck, or close the run and take the unpaid balance back. */
export function PayControls({ batchId, status }: { batchId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function go(kind: "pay" | "open" | "recover" | "close") {
    setBusy(kind);
    setError(null);
    setNote(null);
    if (kind === "pay") setError(await payAll(batchId, setNote));
    else {
      const url = { open: `/api/batches/${batchId}/open`, recover: "/api/payments/recover", close: `/api/batches/${batchId}/close` }[kind];
      const r = await postJson<{ checked?: number; settled?: number }>(url);
      if (!r.ok) setError(r.error ?? "That did not work");
      else if (kind === "recover") setNote(`Checked ${r.data?.checked ?? 0} payments, ${r.data?.settled ?? 0} confirmed from Arc.`);
    }
    setBusy(null);
    router.refresh();
  }
  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-3">
        {status === "AUTHORIZED" && (
          <Button type="button" disabled={!!busy} className={big} onClick={() => go("open")}>
            {busy === "open" ? "Opening…" : "Finish opening the run"}
          </Button>
        )}
        {status === "OPEN" && (
          <>
            <Button type="button" disabled={!!busy} className={big} onClick={() => go("pay")}>
              {busy === "pay" ? "Paying…" : "Continue paying"}
            </Button>
            <Button type="button" variant="outline" disabled={!!busy} className={big} onClick={() => go("recover")}>
              {busy === "recover" ? "Checking Arc…" : "Check payments on Arc"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!!busy}
              className={big}
              onClick={() => window.confirm("Close the run? Unpaid payments stay unpaid and the unspent USDC returns to the approver wallet.") && go("close")}
            >
              {busy === "close" ? "Closing…" : "Close the run"}
            </Button>
          </>
        )}
      </div>
      {note && <p role="status" className="mt-3 text-sm">{note}</p>}
      <Alert error={error} />
    </div>
  );
}

/** Live payments (S66, rule 17). Owner: request and switch ON (password + authenticator code). Owner or payment approver: switch OFF at any time. */
export function LivePaymentsPanel({ liveStatus, enabled, isOwner, canSwitchOff }: { liveStatus: string; enabled: boolean; isOwner: boolean; canSwitchOff: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(body: unknown) {
    setBusy(true);
    setError(null);
    const r = await postJson("/api/company/live-payments", body);
    if (r.ok) router.refresh();
    else setError(r.error ?? "That did not work");
    setBusy(false);
  }

  if (enabled) {
    return (
      <div className="mt-4">
        <p>Live payments are ON. Every payment still needs a signed plan from a payment approver.</p>
        {canSwitchOff && (
          <Button type="button" variant="outline" disabled={busy} className={`${big} mt-4`} onClick={() => send({ action: "switch_off" })}>
            Switch live payments OFF
          </Button>
        )}
        <Alert error={error} />
      </div>
    );
  }
  if (liveStatus === "PROVISIONED") {
    return isOwner ? (
      <form
        className="mt-4 max-w-xl space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          send({ action: "switch_on", password: f.get("password"), code: f.get("code") });
        }}
      >
        <p>Wallets and the guard contract are ready. Switching ON lets payment approvers pay approved runs (Arc testnet, no real funds). It needs your password and a fresh code from your authenticator app.</p>
        <div>
          <Label htmlFor="live-password">Your password</Label>
          <Input id="live-password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <div>
          <Label htmlFor="live-code">Authenticator code</Label>
          <Input id="live-code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required />
        </div>
        <Button type="submit" disabled={busy} className={big}>
          {busy ? "Switching…" : "Switch live payments ON"}
        </Button>
        <Alert error={error} />
      </form>
    ) : (
      <p className="mt-4">Ready. The Owner switches live payments ON with their password and authenticator code.</p>
    );
  }
  if (liveStatus === "REQUESTED") return <p className="mt-4">Requested. The Kleeno team reviews it and sets up the wallets and the guard contract.</p>;
  if (liveStatus === "APPROVED") return <p className="mt-4">Approved. Setting up the wallets and the guard contract is not finished; the Kleeno team resumes it.</p>;
  return isOwner ? (
    <div className="mt-4">
      <p>{liveStatus === "REJECTED" ? "The last request was declined. You can ask again." : "Live payments let this company pay approved runs in USDC on Arc testnet (no real funds). Kleeno reviews the request, then creates your wallets and guard contract."}</p>
      <Button type="button" disabled={busy} className={`${big} mt-4`} onClick={() => send({ action: "request" })}>
        {busy ? "Requesting…" : "Request live payments"}
      </Button>
      <Alert error={error} />
    </div>
  ) : (
    <p className="mt-4">Live payments are not set up. The Owner can request them.</p>
  );
}

/** Mints a signed 30-day public receipt link for one settled payment and copies it. The page shows only the net amount, status and arcscan link. */
export function ReceiptLinkButton({ obligationId }: { obligationId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error">("idle");
  return (
    <button
      type="button"
      disabled={state === "busy"}
      className="text-xs underline underline-offset-4"
      onClick={async () => {
        setState("busy");
        const r = await postJson<{ path: string }>("/api/receipts", { obligationId });
        if (!r.ok || !r.data) return setState("error");
        await navigator.clipboard.writeText(`${window.location.origin}${r.data.path}`).catch(() => undefined);
        setState("copied");
      }}
    >
      {state === "copied" ? "Link copied" : state === "error" ? "Could not create link" : "Copy receipt link"}
    </button>
  );
}

interface TopupResult {
  id: string;
  status: string;
  amount: string;
  done: boolean;
  waiting?: string;
  failure?: string | null;
}

/** Gateway top-up (S67): moves test USDC from Base Sepolia into this company's own approver wallet. The destination is never sent from the browser. */
export function TopUpPanel() {
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TopupResult | null>(null);
  async function run(url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const r = await postJson<TopupResult>(url, body);
    if (r.ok && r.data) {
      setResult(r.data);
      if (r.data.done) router.refresh();
    } else setError(r.error ?? "Top-up failed");
    setBusy(false);
  }
  return (
    <form
      className="mt-4 max-w-xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run("/api/gateway/topup", { requestId, amount: String(f.get("amount")), password: f.get("password") });
      }}
    >
      <p className="text-muted-foreground">Top up the approver wallet with test USDC from Base Sepolia through Circle Gateway (1 to 100 USDC). It can only fund this company&apos;s own wallet.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="topup-amount">Amount (USDC)</Label>
          <Input id="topup-amount" name="amount" inputMode="decimal" placeholder="10" required />
        </div>
        <div>
          <Label htmlFor="topup-password">Your password</Label>
          <Input id="topup-password" name="password" type="password" autoComplete="current-password" required />
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy || !!result} className={big}>
          {busy ? "Working…" : "Top up"}
        </Button>
        {result && !result.done && (
          <Button type="button" variant="outline" disabled={busy} className={big} onClick={() => run(`/api/gateway/topup/${result.id}`)}>
            Check progress
          </Button>
        )}
      </div>
      {result && (
        <p role="status" className="text-sm">
          {result.done ? (result.status === "COMPLETE" ? `Top-up of ${result.amount} USDC arrived.` : `Top-up failed${result.failure ? `: ${result.failure}` : ""}.`) : `In progress: ${result.waiting ?? result.status}.`}
        </p>
      )}
      <Alert error={error} />
    </form>
  );
}
