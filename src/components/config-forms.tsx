"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { postJson } from "@/lib/api";

const big = "h-11 rounded-[1.25rem] px-6 text-base";
const area = "min-h-48 w-full rounded-[1.25rem] border border-primary/50 bg-white px-5 py-4 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40";

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
  return (
    <form
      className="mt-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setResult(null);
        const r = await postJson<Proposal>("/api/configs", { policyText: new FormData(e.currentTarget).get("policyText") });
        if (r.ok && r.data) {
          setResult(r.data);
          if (r.data.config) router.refresh();
        } else setError(r.error ?? "Could not read the policy");
        setBusy(false);
      }}
    >
      <Label htmlFor="policyText">Your pay policy, one rule per line</Label>
      <textarea id="policyText" name="policyText" className={area} required maxLength={40000} placeholder={"Full-time staff work 40 hours a week, 160 hours per period.\nOvertime above 40 hours a week is paid at 1.5 times the hourly rate when approved.\nTax is withheld at 10% of gross pay."} />
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
      <Button type="submit" disabled={busy} className={`mt-5 ${big}`}>
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
  const needsConfirm = c.status === "HUMAN_REVIEW" && c.flags.length > 0;

  async function act(action: string) {
    setBusy(true);
    setError(null);
    const r = await postJson(`/api/configs/${c.id}`, { action, confirmFlags: confirm });
    if (r.ok) router.refresh();
    else setError(r.error ?? "Something went wrong");
    setBusy(false);
  }

  return (
    <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl">Version {c.version}</h2>
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

      <h3 className="mt-8 text-lg">Rules and the policy lines they come from</h3>
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

      {c.flags.length > 0 && (
        <div className="mt-8 rounded-[1.25rem] border border-signal p-5">
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
            <Button key={a.action} type="button" disabled={busy || (a.action === "approve" && needsConfirm && !confirm)} variant={a.action === "approve" || a.action === "activate" ? "default" : "ghost"} className={big} onClick={() => act(a.action)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
