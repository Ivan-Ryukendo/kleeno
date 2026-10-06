"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { postJson } from "@/lib/api";
import { PolicyUpload, type PolicyUploadPayload } from "@/components/policy-upload";

const big = "h-9 rounded-field px-4 text-sm";
const area = "min-h-48 w-full rounded-box border border-field-border bg-white px-3 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40";

interface Proposal {
  status: "ACCEPTED" | "REPAIRED" | "NEEDS_HUMAN_REVIEW";
  problems: string[];
  config: { version: number } | null;
}

/** Policy text in, AI proposal out. The result always waits for a human; AI text is shown as plain text (rule 6). */
export function PolicyForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Proposal | null>(null);
  const [upload, setUpload] = useState<PolicyUploadPayload | null>(null);
  const [uploadPending, setUploadPending] = useState(false);
  return (
    <form
      className="mt-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (uploadPending) return;
        setBusy(true);
        setError(null);
        setResult(null);
        const r = await postJson<Proposal>("/api/configs", upload ?? { policyText: new FormData(e.currentTarget).get("policyText") });
        if (r.ok && r.data) {
          setResult(r.data);
          if (r.data.config) router.refresh();
        } else setError(r.error ?? "Could not read the policy");
        setBusy(false);
      }}
    >
      <PolicyUpload onChange={setUpload} onPendingChange={setUploadPending} disabled={busy} />
      <Label htmlFor="policyText">{upload ? "Reviewed policy text" : "Or enter your pay policy, one rule per line"}</Label>
      <textarea key={upload ? "reviewed" : "manual"} id="policyText" name="policyText" className={area} value={upload?.policyText} readOnly={!!upload} disabled={busy || uploadPending} required={!upload} maxLength={40000} placeholder={"Full-time staff work 40 hours a week, 160 hours per period.\nOvertime above 40 hours a week is paid at 1.5 times the hourly rate when approved.\nTax is withheld at 10% of gross pay."} />
      <p className="mt-2 text-sm text-muted-foreground">Write amounts and percentages as numbers. Individual salaries and rates are set per worker, not here. The text is sent to an AI model; do not include names.</p>
      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-signal">
          {error}
        </p>
      )}
      {result && (
        <p role="status" className="mt-4 text-sm font-medium">
          {result.config ? `Version ${result.config.version} is ready for your review below.` : `The AI could not produce a safe proposal: ${result.problems.join("; ") || "no reason given"}. Adjust the text and try again.`}
        </p>
      )}
      <Button type="submit" disabled={busy || uploadPending} className={`mt-5 ${big}`}>
        {busy ? "Reading your policy…" : "Ask AI to propose rules"}
      </Button>
    </form>
  );
}

export interface ConfigCardView {
  id: string;
  version: number;
  status: string;
  aiAssisted: boolean;
  flags: string[];
  confirmed: boolean;
  values: { label: string; value: string }[];
  rules: { ruleId: string; clauses: { id: string; text: string }[] }[];
  warnings?: string[];
  documents?: { id: string; format: string; clauses: { id: string; anchor: string }[] }[];
  scope?: { problems: string[]; warnings: string[]; overrides: { key: string; workerId: string; parameter: string; winner: string; overridden: string[] }[]; coverage: { workerId: string; ruleIds: string[] }[] };
  scopedRules?: { id: string; category: string; clauses: { id: string; text: string }[]; values: { label: string; value: string }[] }[];
}

const nextActions: Record<string, { action: string; label: string }[]> = {
  HUMAN_REVIEW: [
    { action: "approve", label: "Approve this version" },
    { action: "send_back", label: "Send back" },
  ],
  APPROVED: [{ action: "activate", label: "Make this the active version" }],
  ACTIVE: [{ action: "archive", label: "Archive" }],
};

export function ConfigCard({ c, canEdit }: { c: ConfigCardView; canEdit: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmedOverrides, setConfirmedOverrides] = useState<string[]>([]);
  const needsConfirm = c.status === "HUMAN_REVIEW" && c.flags.length > 0;

  async function act(action: string) {
    setBusy(true);
    setError(null);
    const r = await postJson(`/api/configs/${c.id}`, { action, confirmFlags: confirm, confirmOverrides: confirmedOverrides });
    if (r.ok) router.refresh();
    else setError(r.error ?? "Something went wrong");
    setBusy(false);
  }

  return (
    <section className="mt-6 panel">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg">Version {c.version}</h2>
        <StatusPill status={c.status} />
        {c.aiAssisted && <span className="text-sm text-muted-foreground">Suggested by AI, not applied until you approve</span>}
      </div>

      <dl className="mt-6 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        {c.values.map((v) => (
          <div key={v.label} className="flex justify-between border-b border-border py-2">
            <dt className="text-muted-foreground">{v.label}</dt>
            <dd className="font-medium">{v.value}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-6 text-lg">Rules and the policy lines they come from</h3>
      <ul className="mt-3 space-y-3 text-sm">
        {c.rules.map((r) => (
          <li key={r.ruleId}>
            <span className="font-medium">{r.ruleId.replaceAll("_", " ").toLowerCase()}</span>
            {r.clauses.map((cl) => (
              <p key={cl.id} className="mt-1 text-muted-foreground">
                <span className="mr-2 font-medium text-foreground">{cl.id}</span>
                {cl.text}
              </p>
            ))}
          </li>
        ))}
      </ul>
      {!!c.documents?.length && <details className="mt-5 text-sm"><summary className="cursor-pointer font-medium">Reviewed document origins ({c.documents.length})</summary><ul className="mt-3 space-y-2">{c.documents.map((d, i) => <li key={d.id}>Document {i + 1} · {d.format.toUpperCase()}<ul className="pl-4 text-muted-foreground">{d.clauses.map(cl => <li key={cl.id}>{cl.id} · {cl.anchor}</li>)}</ul></li>)}</ul></details>}
      {!!c.scopedRules?.length && <div className="mt-5 space-y-3 text-sm"><h3 className="font-medium">Rule scopes</h3>{c.scopedRules.map(r => <div key={r.id} className="rounded-box border border-border p-3"><p className="font-medium">{r.id} · {r.category.replaceAll("_", " ").toLowerCase()}</p>{r.values.map(v => <p key={v.label}>{v.label}: {v.value}</p>)}{r.clauses.map(cl => <p key={cl.id} className="mt-1 text-muted-foreground">{cl.id}: {cl.text}</p>)}</div>)}</div>}
      {c.scope && <div className="mt-5 text-sm"><h3 className="font-medium">Coverage and overrides</h3><details className="mt-2"><summary className="cursor-pointer">Worker coverage ({c.scope.coverage.length})</summary><ul className="mt-2 space-y-1">{c.scope.coverage.map(w => <li key={w.workerId}>{w.workerId}: {w.ruleIds.join(", ") || "company defaults"}</li>)}</ul></details>{c.scope.overrides.map(o => <label key={o.key} className="mt-3 flex min-h-11 items-start gap-3 rounded-box border border-border p-3"><input type="checkbox" className="mt-0.5 size-4" checked={confirmedOverrides.includes(o.key)} disabled={!canEdit || c.status !== "HUMAN_REVIEW" || busy} onChange={e => setConfirmedOverrides(v => e.target.checked ? [...v, o.key] : v.filter(k => k !== o.key))} /><span>{o.workerId}: {o.winner} replaces {o.overridden.join(", ")} for {o.parameter}. Confirm this override.</span></label>)}{c.scope.problems.map(p => <p key={p} role="alert" className="mt-2 text-signal">{p}</p>)}</div>}
      {!![...(c.warnings ?? []), ...(c.scope?.warnings ?? [])].length && <div className="mt-5 rounded-box border border-border p-4 text-sm"><p className="font-medium">Review warnings</p><ul className="mt-2 list-disc pl-5">{[...new Set([...(c.warnings ?? []), ...(c.scope?.warnings ?? [])])].map(w => <li key={w}>{w}</li>)}</ul></div>}

      {c.flags.length > 0 && (
        <div className="mt-6 rounded-box border border-signal p-4">
          <p className="font-medium text-signal">{c.confirmed ? "You confirmed these values" : "Check these values before approving"}</p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {c.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {needsConfirm && canEdit && (
            <label className="mt-4 flex items-center gap-3 text-sm">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="size-4" />
              I have checked these values against my policy and they are correct
            </label>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-signal">
          {error}
        </p>
      )}
      {canEdit && (
        <div className="mt-6 flex flex-wrap gap-3">
          {(nextActions[c.status] ?? []).map((a) => (
            <Button key={a.action} type="button" disabled={busy || (a.action === "approve" && ((needsConfirm && !confirm) || !!c.scope?.problems.length || !!c.scope?.overrides.some(o => !confirmedOverrides.includes(o.key))))} variant={a.action === "approve" || a.action === "activate" ? "default" : "ghost"} className={big} onClick={() => act(a.action)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
