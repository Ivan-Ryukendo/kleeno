"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LEAD_ACTIONS, type LeadAction } from "@/core/growth";
import { Input, Label } from "@/components/ui/input";
import { postJson } from "@/lib/api";
import { cn } from "@/lib/utils";

const ink = "inline-flex h-11 items-center justify-center rounded-[1.25rem] bg-primary px-6 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50";
const outline = "inline-flex h-11 items-center justify-center rounded-[1.25rem] border-[1.5px] border-primary bg-white px-5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50";

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm font-medium text-signal">
      {error}
    </p>
  ) : null;
}

type LoginStep = { kind: "password" } | { kind: "mfa"; factorId: string } | { kind: "enrol"; factorId: string; qr: string; secret: string };

/** Admin sign-in: password, then TOTP (first sign-in enrols an authenticator). All calls go to <base>/api/... */
export function AdminLoginForm({ base }: { base: string }) {
  const router = useRouter();
  const [step, setStep] = useState<LoginStep>({ kind: "password" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    if (step.kind === "password") {
      const r = await postJson<{ next: string; factorId?: string }>(`${base}/api/login`, { email: f.get("email"), password: f.get("password") });
      if (!r.ok) setError(r.error ?? "Sign-in failed");
      else if (r.data?.next === "mfa" && r.data.factorId) setStep({ kind: "mfa", factorId: r.data.factorId });
      else {
        const en = await postJson<{ factorId: string; qr: string; secret: string }>(`${base}/api/mfa/enroll`);
        if (!en.ok || !en.data) setError(en.error ?? "Could not start authenticator setup");
        else setStep({ kind: "enrol", ...en.data });
      }
    } else {
      const r = await postJson(`${base}/api/mfa/verify`, { factorId: step.factorId, code: f.get("code") });
      if (!r.ok) setError(r.error ?? "That code is not valid");
      else {
        router.push(base);
        router.refresh();
      }
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      {step.kind === "password" ? (
        <>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
        </>
      ) : (
        <>
          {step.kind === "enrol" && (
            <div className="space-y-3">
              <p>Scan this code with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code.</p>
              {/* Supabase returns the QR as an SVG data URL; it is an image, not markup we inject. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={step.qr} alt="Authenticator QR code" className="size-48 rounded-[1.25rem] bg-white p-3" />
              <p className="break-all text-sm text-muted-foreground">
                Can&apos;t scan? Enter this key: <span className="font-mono">{step.secret}</span>
              </p>
            </div>
          )}
          <div>
            <Label htmlFor="code">Code from your authenticator app</Label>
            <Input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required autoFocus />
          </div>
        </>
      )}
      <ErrorText error={error} />
      <button type="submit" disabled={busy} className={cn(ink, "w-full")}>
        {step.kind === "password" ? "Sign in" : "Verify"}
      </button>
    </form>
  );
}

export function AdminSignOut({ base }: { base: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={outline}
      onClick={async () => {
        await postJson(`${base}/api/logout`);
        router.push(`${base}/login`);
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}

const ACTION_LABELS: Record<LeadAction, string> = {
  QUALIFY: "Qualify",
  SCHEDULE_CALL: "Call scheduled",
  CALL_DONE: "Call done",
  MARK_PILOT: "Pilot candidate",
  CLOSE: "Close",
  UNSUBSCRIBE: "Unsubscribed",
  REOPEN: "Reopen as new",
};

/** Status buttons, notes/follow-up/test flag, and deletion on request for one contact. */
export function ContactActions({ base, id, status, notes, nextActionAt, isTest }: { base: string; id: string; status: string; notes: string | null; nextActionAt: string | null; isTest: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = `${base}/api/contacts/${id}`;

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await postJson(url, body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Something went wrong");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="status-title">
        <h2 id="status-title" className="text-xl font-medium">Lead status</h2>
        <p className="mt-1 text-sm text-muted-foreground">Every change is recorded in the history below. A budget answer alone never qualifies a lead.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(ACTION_LABELS) as LeadAction[])
            .filter((a) => LEAD_ACTIONS[a] !== status)
            .map((a) => (
              <button key={a} type="button" disabled={busy} className={outline} onClick={() => send({ action: a })}>
                {ACTION_LABELS[a]}
              </button>
            ))}
        </div>
      </section>

      <form
        aria-labelledby="notes-title"
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const ok = await send({ action: "SAVE", notes: String(f.get("notes") ?? "") || null, nextActionAt: String(f.get("nextActionAt") ?? "") || null, isTest: f.get("isTest") === "on" });
          setSaved(ok);
        }}
      >
        <h2 id="notes-title" className="text-xl font-medium">Notes and follow-up</h2>
        <div>
          <Label htmlFor="notes">Private notes</Label>
          <textarea id="notes" name="notes" defaultValue={notes ?? ""} maxLength={5000} rows={6} className="w-full rounded-[1.25rem] border border-primary/50 bg-white px-5 py-3 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40" />
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <Label htmlFor="nextActionAt">Next action on</Label>
            <Input id="nextActionAt" name="nextActionAt" type="date" defaultValue={nextActionAt ?? ""} className="w-auto" />
          </div>
          <label className="flex items-center gap-2 pb-3 text-sm">
            <input type="checkbox" name="isTest" defaultChecked={isTest} className="size-5 accent-primary" />
            Test record (excluded from every metric)
          </label>
        </div>
        <div className="flex items-center gap-4">
          <button type="submit" disabled={busy} className={ink}>Save</button>
          {saved && <span role="status" className="text-sm">Saved</span>}
        </div>
      </form>

      <ErrorText error={error} />

      <section aria-labelledby="delete-title" className="rounded-[1.25rem] border border-signal/40 p-6">
        <h2 id="delete-title" className="text-xl font-medium">Delete on request</h2>
        <p className="mt-1 text-sm text-muted-foreground">Permanently removes this contact, their answers and history. Use when someone asks to be deleted.</p>
        <button
          type="button"
          disabled={busy}
          className="mt-4 inline-flex h-11 items-center rounded-[1.25rem] bg-signal px-6 text-sm font-medium text-white disabled:opacity-50"
          onClick={async () => {
            if (!window.confirm("Delete this contact permanently? This cannot be undone.")) return;
            if (await send({ action: "DELETE", confirm: "DELETE" })) router.push(base);
          }}
        >
          Delete contact
        </button>
      </section>
    </div>
  );
}

/** Approve a waitlist entry into a company with a one-time Owner invite link (S64). The link is shown once; only its hash is stored. */
export function AccessApproval({ base, id, invites }: { base: string; id: string; invites: { id: string; status: string; createdAt: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sandbox, setSandbox] = useState(false);
  const [issued, setIssued] = useState<{ link: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const active = invites.some((i) => i.status === "PENDING" || i.status === "USED");

  return (
    <section aria-labelledby="access-title" className="space-y-4">
      <h2 id="access-title" className="text-xl font-medium">Platform access</h2>
      <p className="text-sm text-muted-foreground">Approving creates a company for this contact and a one-time invite link for them as its Owner (7 days, works once, only for their email). It starts in simulation; live payments stay off.</p>
      {invites.length > 0 && (
        <ul className="space-y-1 text-sm">
          {invites.map((i) => (
            <li key={i.id}>
              {new Date(i.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}: invite {i.status.toLowerCase()}
            </li>
          ))}
        </ul>
      )}
      {!active && (
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} className="size-5 accent-primary" />
            Sandbox for a judge (simulation only, never live payments)
          </label>
          <button
            type="button"
            disabled={busy}
            className={ink}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await postJson<{ link: string; emailed: boolean }>(`${base}/api/contacts/${id}`, { action: "APPROVE_ACCESS", sandbox });
              setBusy(false);
              if (!r.ok || !r.data) return setError(r.error ?? "Could not approve");
              setIssued(r.data);
              router.refresh();
            }}
          >
            Approve access
          </button>
        </div>
      )}
      <ErrorText error={error} />
      {issued && (
        <div className="rounded-[1.25rem] border border-primary/30 bg-white p-5" role="status">
          <p className="text-sm font-medium">{issued.emailed ? "Emailed to the contact. This link is shown only now:" : "Send this link to the contact. It is shown only now:"}</p>
          <div className="mt-3 flex gap-3">
            <Input readOnly value={issued.link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className={outline}
              onClick={async () => {
                await navigator.clipboard.writeText(issued.link);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Platform admin decision on a live-payments request. Approving provisions wallets and the guard (can take a minute); approving again resumes. */
export function LiveRequestActions({ base, companyId, status }: { base: string; companyId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(action: "approve" | "reject") {
    setBusy(action);
    setError(null);
    const r = await postJson(`${base}/api/live-payments/${companyId}`, { action });
    if (r.ok) router.refresh();
    else setError(r.error ?? "That did not work");
    setBusy(null);
  }
  if (status === "PROVISIONED" || status === "REJECTED") return <span className="text-muted-foreground">Done</span>;
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button type="button" disabled={!!busy} onClick={() => decide("approve")} className={ink}>
          {busy === "approve" ? "Setting up…" : status === "APPROVED" ? "Resume setup" : "Approve and set up"}
        </button>
        {status === "REQUESTED" && (
          <button type="button" disabled={!!busy} onClick={() => decide("reject")} className={outline}>
            Reject
          </button>
        )}
      </div>
      <ErrorText error={error} />
    </div>
  );
}
