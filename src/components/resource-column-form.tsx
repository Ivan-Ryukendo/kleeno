"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ResourceDefinitionSchema, ResourceInputSchema, evaluateResource, resourceFormula, type ResourceDefinition } from "@/core/views/resources";
import { postJson } from "@/lib/api";

export interface ResourceColumn { id: string; columnKey: string; definition: ResourceDefinition }
const field = "mt-1 block min-h-10 w-full rounded-field border bg-background px-3 text-sm";

/** HR reviews explicit policy settings; no inferred leave entitlement, KPI or worker facts. */
export function ResourceColumnForm() {
  const router = useRouter();
  const [kind, setKind] = useState<ResourceDefinition["rule"]["kind"]>("INPUT");
  const [values, setValues] = useState<Record<string, string>>({ type: "text", unit: "DAYS", accrual: "ANNUAL", creditTiming: "START" });
  const [metrics, setMetrics] = useState([{ id: "kpi1", label: "", weight: "100" }]);
  const [review, setReview] = useState<ResourceDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<ResourceDefinition[]>([]);
  const [proposalStatus, setProposalStatus] = useState<string | null>(null);
  const update = (key: string, value: string) => { setValues((v) => ({ ...v, [key]: value })); setReview(null); };
  const input = (key: string, label: string, type = "text") => <label className="text-sm" key={key}>{label}<Input className="mt-1 min-h-10" type={type} value={values[key] ?? ""} onChange={(e) => update(key, e.target.value)} required /></label>;
  const choice = (key: string, label: string, options: string[]) => <label className="text-sm">{label}<select className={field} value={values[key]} onChange={(e) => update(key, e.target.value)}>{options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ").toLowerCase()}</option>)}</select></label>;
  function preview() {
    const rule = kind === "INPUT" ? { kind, type: values.type } : kind === "ATTENDANCE_DAYS" ? { kind } : kind === "PERFORMANCE" ? { kind, metrics } : { kind, unit: values.unit, yearStart: values.yearStart, yearEnd: values.yearEnd, accrual: values.accrual, entitlement: values.entitlement, creditTiming: values.creditTiming, carryOverCap: values.carryOverCap, carryOverExpiresOn: values.carryOverExpiresOn || null };
    const parsed = ResourceDefinitionSchema.safeParse({ label: values.label ?? "", policy: values.configVersion || values.clauseIds ? { configVersion: Number(values.configVersion), clauseIds: (values.clauseIds ?? "").split(",").map((s) => s.trim()).filter(Boolean) } : null, rule });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Complete the column definition."); return; }
    if (!(values.reason ?? "").trim()) { setError("Explain why this resource column is needed."); return; }
    setError(null); setReview(parsed.data);
  }
  async function save() {
    if (!review) return;
    setBusy(true);
    const response = await postJson("/api/views/resources", { definition: review, reason: values.reason });
    setBusy(false);
    if (!response.ok) { setError(response.error ?? "Could not save the column."); return; }
    setReview(null); setValues((v) => ({ ...v, label: "", reason: "" })); router.refresh();
    setError(null);
  }
  async function suggest() {
    const configVersion = Number(values.configVersion);
    if (!Number.isSafeInteger(configVersion) || configVersion < 1) { setError("Choose the approved policy version before requesting suggestions."); return; }
    setBusy(true);
    const response = await postJson<{ status: string; executionId: string; proposals: ResourceDefinition[]; problems: string[] }>("/api/views/resources/propose", { configVersion });
    setBusy(false);
    if (!response.ok || !response.data) { setError(response.error ?? "Could not suggest resource columns."); return; }
    setProposals(response.data.proposals); setProposalStatus(response.data.status); setError(response.data.problems.length ? response.data.problems.join(" · ") : null);
  }
  function chooseProposal(definition: ResourceDefinition) {
    setKind(definition.rule.kind);
    setValues((current) => ({ ...current, label: definition.label, configVersion: String(definition.policy?.configVersion ?? ""), clauseIds: definition.policy?.clauseIds.join(", ") ?? "", ...Object.fromEntries(Object.entries(definition.rule).filter(([key]) => !["kind", "metrics"].includes(key)).map(([key, value]) => [key, String(value ?? "")])), reason: "" }));
    if (definition.rule.kind === "PERFORMANCE") setMetrics(definition.rule.metrics);
    setReview(null); setError(null);
  }
  return <details className="mt-6 rounded-card border p-4"><summary className="min-h-11 cursor-pointer font-medium">Add a reviewed resource column</summary><p className="mt-2 text-xs text-muted-foreground">Resource columns describe evidence. They never change payroll calculations or authorize payments.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">{input("label", "Column label")}<label className="text-sm">Resource<select className={field} value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setReview(null); }}>{[["INPUT", "Custom source input"], ["ATTENDANCE_DAYS", "Attendance days"], ["LEAVE_BALANCE", "Leave balance"], ["PERFORMANCE", "Performance score"]].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      {kind === "INPUT" && choice("type", "Input type", ["text", "number", "date"])}
      {input("configVersion", kind === "INPUT" ? "Approved policy version (optional)" : "Approved policy version", "number")}{input("clauseIds", kind === "INPUT" ? "Clause IDs, comma separated (optional)" : "Clause IDs, comma separated")}
      {kind === "LEAVE_BALANCE" && <>{choice("unit", "Balance unit", ["DAYS", "HOURS"])}{choice("accrual", "Accrual frequency", ["ANNUAL", "MONTHLY"])}{input("yearStart", "Leave year starts", "date")}{input("yearEnd", "Leave year ends", "date")}{input("entitlement", "Annual entitlement", "number")}{choice("creditTiming", "Credit entitlement at", ["START", "END"])}{input("carryOverCap", "Carry-over cap", "number")}<label className="text-sm">Carry-over expires (optional)<Input className="mt-1 min-h-10" type="date" value={values.carryOverExpiresOn ?? ""} onChange={(e) => update("carryOverExpiresOn", e.target.value)} /></label></>}
    </div>
    <div className="mt-4"><Button className="min-h-11" variant="outline" disabled={busy} onClick={suggest}>{busy ? "Working…" : "Suggest columns from approved policy"}</Button>{proposalStatus && <p role="status" className="mt-2 text-xs text-muted-foreground">Suggested by AI, not applied · {proposalStatus.replaceAll("_", " ").toLowerCase()}{!proposals.length ? " · No validated proposals; review the policy and required settings." : ""}</p>}<ul className="mt-3 space-y-2">{proposals.map((proposal, i) => <li key={i} className="rounded-field border p-3"><p className="font-medium">{proposal.label}</p><p className="mt-1 text-sm text-muted-foreground">{resourceFormula(proposal)}</p><p className="mt-1 text-xs text-muted-foreground">Policy v{proposal.policy?.configVersion} · {proposal.policy?.clauseIds.join(", ")}</p><Button className="mt-2 min-h-11" variant="outline" onClick={() => chooseProposal(proposal)}>Review and edit this proposal</Button></li>)}</ul></div>
    {kind === "PERFORMANCE" && <fieldset className="mt-4 space-y-3"><legend className="font-medium">KPIs · weights must total 100%</legend>{metrics.map((metric, i) => <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_6rem_auto]">{(["id", "label", "weight"] as const).map((key) => <label key={key} className="text-xs">{key === "id" ? "Stable KPI ID" : key === "label" ? "KPI label" : "Weight %"}<Input className="mt-1 min-h-10" value={metric[key]} onChange={(e) => { setMetrics((m) => m.map((x, j) => j === i ? { ...x, [key]: e.target.value } : x)); setReview(null); }} /></label>)}<Button className="self-end min-h-10" variant="outline" disabled={metrics.length === 1} onClick={() => { setMetrics((m) => m.filter((_, j) => i !== j)); setReview(null); }}>Remove</Button></div>)}<Button variant="outline" disabled={metrics.length >= 10} onClick={() => { setMetrics((m) => [...m, { id: `kpi${m.length + 1}`, label: "", weight: "" }]); setReview(null); }}>Add KPI</Button></fieldset>}
    <label className="mt-4 block text-sm">Reason<Textarea className="mt-1" maxLength={500} value={values.reason ?? ""} onChange={(e) => update("reason", e.target.value)} /></label>
    {error && <p role="alert" className="mt-3 text-sm text-signal">{error}</p>}
    {review ? <div className="mt-4 rounded-field border p-4"><h3 className="font-medium">Review: {review.label}</h3><p className="mt-2 text-sm">{resourceFormula(review)}</p><p className="mt-2 text-xs text-muted-foreground">{review.policy ? `Policy v${review.policy.configVersion} · ${review.policy.clauseIds.join(", ")}` : "HR custom source input"}</p><dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">{Object.entries(review.rule).filter(([key]) => key !== "metrics").map(([key, value]) => <div key={key}><dt className="text-muted-foreground">{key}</dt><dd>{String(value ?? "No expiry")}</dd></div>)}</dl>{review.rule.kind === "PERFORMANCE" && <ul className="mt-3 text-sm">{review.rule.metrics.map((m) => <li key={m.id}>{m.label} · {m.weight}% · {m.id}</li>)}</ul>}<Button className="mt-4 min-h-11" disabled={busy} onClick={save}>{busy ? "Saving…" : "Confirm reviewed column"}</Button></div> : <Button className="mt-4 min-h-11" variant="outline" onClick={preview}>Preview formula and review</Button>}
  </details>;
}

export function ResourceInputForm({ resource, workerId, onSaved }: { resource: ResourceColumn; workerId: string; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [version, setVersion] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/views/resources/${resource.id}/inputs?workerId=${encodeURIComponent(workerId)}`).then(async (response) => {
      const json = await response.json();
      if (!response.ok) throw new Error("Could not load the reviewed source input.");
      if (cancelled) return;
      setVersion(json.version); setLoaded(true);
      if (json.input) setValues(Object.fromEntries(Object.entries(json.input).filter(([, value]) => typeof value === "string").map(([key, value]) => [key, value as string]).concat(json.input.dates ? [["dates", json.input.dates.join("\n")]] : [], json.input.metrics ? json.input.metrics.flatMap((m: { id: string; actual: string; target: string }) => [[`${m.id}_actual`, m.actual], [`${m.id}_target`, m.target]]) : [])));
    }).catch(() => { if (!cancelled) setError("Could not load the input. Close and reopen this cell to retry."); });
    return () => { cancelled = true; };
  }, [resource.id, workerId]);
  const update = (key: string, value: string) => { setValues((v) => ({ ...v, [key]: value })); setPreview(null); };
  const input = (key: string, label: string, type = "text") => <label key={key} className="block text-sm">{label}<Input className="mt-1 min-h-10" type={type} value={values[key] ?? ""} onChange={(e) => update(key, e.target.value)} /></label>;
  const rule = resource.definition.rule;
  function review() {
    const base = { sourceRef: values.sourceRef ?? "", reason: values.reason ?? "" };
    const period = { periodStart: values.periodStart, periodEnd: values.periodEnd };
    const raw = rule.kind === "INPUT" ? { ...base, value: values.value ?? "" } : rule.kind === "ATTENDANCE_DAYS" ? { ...base, ...period, dates: (values.dates ?? "").split(/[,\n]/).map((date) => date.trim()).filter(Boolean) } : rule.kind === "LEAVE_BALANCE" ? { ...base, openingBalance: values.openingBalance, openingAsOf: values.openingAsOf, carryOver: values.carryOver, used: values.used, asOf: values.asOf } : { ...base, ...period, metrics: rule.metrics.map((m) => ({ id: m.id, actual: values[`${m.id}_actual`], target: values[`${m.id}_target`] })) };
    const parsed = ResourceInputSchema.safeParse(raw);
    if (!parsed.success || evaluateResource(resource.definition, raw).status !== "VERIFIED") { setError("Complete valid evidence, dates and quantities for this formula before reviewing."); return; }
    setError(null); setPreview(parsed.data);
  }
  async function save() {
    setBusy(true);
    const response = await postJson(`/api/views/resources/${resource.id}/inputs`, { workerId, input: preview, expectedVersion: version });
    setBusy(false);
    if (!response.ok) { setError(response.error ?? "Could not save the reviewed input."); return; }
    onSaved();
  }
  return <section className="mt-5 border-t pt-4"><h3 className="font-medium">Review source inputs</h3><p className="mt-1 text-xs text-muted-foreground">Computed results are read-only. Updating evidence creates a reviewed resource version and leaves payroll unchanged.</p><div className="mt-4 space-y-3">
    {rule.kind === "INPUT" && input("value", "Source value", rule.type === "date" ? "date" : rule.type === "number" ? "number" : "text")}
    {(rule.kind === "ATTENDANCE_DAYS" || rule.kind === "PERFORMANCE") && <>{input("periodStart", "Evidence period starts", "date")}{input("periodEnd", "Evidence period ends", "date")}</>}
    {rule.kind === "ATTENDANCE_DAYS" && <label className="block text-sm">Approved attendance dates (one YYYY-MM-DD per line)<Textarea className="mt-1" value={values.dates ?? ""} onChange={(e) => update("dates", e.target.value)} /></label>}
    {rule.kind === "LEAVE_BALANCE" && <>{input("openingBalance", "Opening balance", "number")}{input("openingAsOf", "Opening balance as of", "date")}{input("carryOver", "Carry-over from prior year", "number")}{input("used", "Approved usage", "number")}{input("asOf", "Balance as of", "date")}</>}
    {rule.kind === "PERFORMANCE" && rule.metrics.map((metric) => <fieldset key={metric.id} className="space-y-2 rounded-field border p-3"><legend className="px-1 text-sm">{metric.label} · {metric.weight}% weight</legend>{input(`${metric.id}_actual`, "Actual", "number")}{input(`${metric.id}_target`, "Target", "number")}</fieldset>)}
    {input("sourceRef", "Approved source reference")}<label className="block text-sm">Review reason<Textarea className="mt-1" maxLength={500} value={values.reason ?? ""} onChange={(e) => update("reason", e.target.value)} /></label>
    {!loaded && !error && <p role="status" className="text-xs text-muted-foreground">Loading saved source inputs…</p>}{error && <p role="alert" className="text-sm text-signal">{error}</p>}
    {preview ? <div className="rounded-field border p-3"><p className="font-medium">Reviewed result: {evaluateResource(resource.definition, preview).value} {evaluateResource(resource.definition, preview).unit}</p><p className="mt-1 text-xs text-muted-foreground">{resourceFormula(resource.definition)}</p><Button className="mt-3 min-h-11" disabled={busy} onClick={save}>{busy ? "Saving…" : "Confirm reviewed input"}</Button></div> : <Button className="min-h-11" variant="outline" disabled={!loaded} onClick={review}>Review result</Button>}
  </div></section>;
}
