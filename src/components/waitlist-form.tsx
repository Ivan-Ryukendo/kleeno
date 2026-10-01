"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BUDGET_LABELS, CONSENT_TEXT, PAIN_LABELS, ROLE_LABELS, SIZE_LABELS } from "@/core/growth";
import { Input, Label } from "@/components/ui/input";
import { postJson } from "@/lib/api";
import { cn } from "@/lib/utils";

type Step = { kind: "email" } | { kind: "survey"; token: string } | { kind: "done"; surveyed: boolean };

const ink = "inline-flex h-12 items-center justify-center rounded-[1.25rem] bg-primary px-7 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50";
const outline = "inline-flex h-12 items-center justify-center rounded-[1.25rem] border-[1.5px] border-primary bg-white px-7 text-base font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50";
const select = "h-11 w-full rounded-full border border-primary/50 bg-white px-5 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40";

/** Attribution from the URL and the referring site (hostname only). Nothing identifies the visitor. */
function attribution() {
  const q = new URLSearchParams(window.location.search);
  const clean = (v: string | null) => v?.replace(/[^\w .:/@+-]/g, "").slice(0, 100) || undefined;
  let source: string | undefined;
  try {
    const host = document.referrer ? new URL(document.referrer).hostname : "";
    if (host && host !== window.location.hostname) source = clean(host);
  } catch {}
  return { source: clean(q.get("ref")) ?? source, utmSource: clean(q.get("utm_source")), utmMedium: clean(q.get("utm_medium")), utmCampaign: clean(q.get("utm_campaign")) };
}

function Choices<T extends string>({ name, legend, hint, labels, value, onChange }: { name: string; legend: string; hint?: string; labels: Record<T, string>; value: T | undefined; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="text-lg font-medium tracking-tight">{legend}</legend>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.keys(labels) as T[]).map((k) => (
          <label
            key={k}
            className="cursor-pointer rounded-full border border-primary/40 bg-white px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-3 has-focus-visible:ring-ring/40"
          >
            <input type="radio" name={name} value={k} checked={value === k} onChange={() => onChange(k)} className="sr-only" />
            {labels[k]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function WaitlistForm() {
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opened = useRef(0);
  const [answers, setAnswers] = useState<{ painPoint?: keyof typeof PAIN_LABELS; budgetBand?: keyof typeof BUDGET_LABELS; wantsCall?: boolean }>({});
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    opened.current = Date.now();
  }, []);
  useEffect(() => {
    if (step.kind !== "email") heading.current?.focus(); // move focus so screen readers hear the new step
  }, [step.kind]);

  async function join(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const r = await postJson<{ token: string | null }>("/api/waitlist", {
      email: String(f.get("email") ?? ""),
      consent: f.get("consent") === "on",
      website: String(f.get("website") ?? "") || undefined,
      elapsedMs: Math.min(Date.now() - opened.current, 86_400_000),
      ...attribution(),
    });
    setBusy(false);
    if (!r.ok) return setError(r.error?.includes("invalid request: email") ? "Please enter a valid email address." : (r.error ?? "Something went wrong. Please try again."));
    setStep(r.data?.token ? { kind: "survey", token: r.data.token } : { kind: "done", surveyed: false });
  }

  async function survey(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.kind !== "survey") return;
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    const body = { token: step.token, ...answers, role: text("role"), companyName: text("companyName"), companySize: text("companySize") };
    if (Object.values(body).filter((v) => v !== undefined).length === 1) return setStep({ kind: "done", surveyed: false }); // nothing answered = skip
    setBusy(true);
    setError(null);
    const r = await postJson("/api/waitlist/survey", body);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Something went wrong. Please try again.");
    setStep({ kind: "done", surveyed: true });
  }

  const errorBox = error && (
    <p role="alert" className="rounded-[1.25rem] border border-primary bg-white px-4 py-3 text-sm font-medium">
      {error}
    </p>
  );

  if (step.kind === "done")
    return (
      <div className="space-y-4" aria-live="polite">
        <h3 ref={heading} tabIndex={-1} className="text-3xl font-medium tracking-tight outline-none">
          You&apos;re on the list.
        </h3>
        <p className="text-lg text-muted-foreground">
          {step.surveyed ? "Thank you for the answers. They shape what we build first. " : ""}
          We&apos;ll email you when Kleeno is ready to try, with pricing and any early-access offer. We haven&apos;t sent anything yet, so there&apos;s nothing to confirm.
        </p>
      </div>
    );

  if (step.kind === "survey")
    return (
      <form onSubmit={survey} className="space-y-7" aria-describedby="survey-note">
        <div>
          <h3 ref={heading} tabIndex={-1} className="text-3xl font-medium tracking-tight outline-none">
            You&apos;re on the list.
          </h3>
          <p id="survey-note" className="mt-2 text-muted-foreground">
            Three optional questions help us build the right thing. Takes 30 seconds, or skip.
          </p>
        </div>
        <Choices name="painPoint" legend="What is the biggest challenge your team faces with payroll operations?" labels={PAIN_LABELS} value={answers.painPoint} onChange={(v) => setAnswers((a) => ({ ...a, painPoint: v }))} />
        <Choices
          name="budgetBand"
          legend="If Kleeno solved this, what monthly budget would your organization consider?"
          hint="For research only. This is not a price, an offer or a commitment."
          labels={BUDGET_LABELS}
          value={answers.budgetBand}
          onChange={(v) => setAnswers((a) => ({ ...a, budgetBand: v }))}
        />
        <Choices
          name="wantsCall"
          legend="Open to a 20-minute call about how you run payroll today?"
          labels={{ yes: "Yes, happy to talk", no: "Not right now" }}
          value={answers.wantsCall === undefined ? undefined : answers.wantsCall ? "yes" : "no"}
          onChange={(v) => setAnswers((a) => ({ ...a, wantsCall: v === "yes" }))}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="role">Your role</Label>
            <select id="role" name="role" defaultValue="" className={select}>
              <option value="">Prefer not to say</option>
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="companyName">Company</Label>
            <Input id="companyName" name="companyName" maxLength={120} autoComplete="organization" />
          </div>
          <div>
            <Label htmlFor="companySize">Team size</Label>
            <select id="companySize" name="companySize" defaultValue="" className={select}>
              <option value="">Prefer not to say</option>
              {Object.entries(SIZE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v} people</option>
              ))}
            </select>
          </div>
        </div>
        {errorBox}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy} className={ink}>
            {busy ? "Sending…" : "Send answers"}
          </button>
          <button type="button" disabled={busy} onClick={() => setStep({ kind: "done", surveyed: false })} className={outline}>
            Skip
          </button>
        </div>
      </form>
    );

  return (
    <form onSubmit={join} className="space-y-5" noValidate={false}>
      <div>
        <Label htmlFor="email" className="text-base">Work email</Label>
        <Input id="email" name="email" type="email" required maxLength={254} autoComplete="email" inputMode="email" placeholder="you@company.com" className="h-12" />
      </div>
      {/* Honeypot (S55): hidden from people and screen readers; bots tend to fill every field. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="flex items-start gap-3 text-sm leading-relaxed">
        <input type="checkbox" name="consent" required className="mt-0.5 size-5 shrink-0 accent-primary" />
        <span>
          {CONSENT_TEXT} See our{" "}
          <Link href="/privacy" className="underline underline-offset-4">privacy note</Link>.
        </span>
      </label>
      {errorBox}
      <button type="submit" disabled={busy} className={cn(ink, "w-full")}>
        {busy ? "Joining…" : "Join the waitlist"}
      </button>
      <p className="text-sm text-muted-foreground">Kleeno is in development. Joining gets you updates and a chance at early access, not guaranteed access.</p>
    </form>
  );
}
