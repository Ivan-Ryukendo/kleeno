import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatUsdc } from "@/core/money";
import { EXPLORER_TX } from "@/server/arc/reader";
import { openJson } from "@/server/crypto";
import { must } from "./client";
import { loadLines } from "./calculations";
import { RECON_CATEGORIES } from "@/core/reconciliation";
import { isPaymentRole, isPayrollRole, type Role } from "@/core/tenancy";
import { auditView } from "./audit";

// Read models for pages. They read through the user-scoped client, so RLS is the second wall behind the company filter (S11).
const usd = (n: number | bigint) => formatUsdc(BigInt(n));

export async function dashboardView(client: SupabaseClient, companyId: string, selectedId?: string) {
  const company = must(await client.from("companies").select("name, live_payments_enabled, guard_address, mfa_required").eq("id", companyId).single(), "company");
  const runs = must(await client.from("payroll_runs").select("id, mode, status, config_version, period_start, period_end, created_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(20), "runs");
  const selectedRead = selectedId ? await client.from("payroll_runs").select("id, mode, status, config_version, period_start, period_end, created_at").eq("company_id", companyId).eq("id", selectedId).maybeSingle() : null;
  if (selectedRead?.error) throw new Error("selected run read failed");
  const selected = selectedRead ? selectedRead.data : runs[0] ?? null;
  return { company, runs, selected };
}

export interface PeriodStep { label: string; state: "done" | "current" | "blocked" | "pending" | "unavailable"; detail: string }
export function periodSteps(status: string, mode: string, openExceptions: number, liveEnabled: boolean): PeriodStep[] {
  const stage: Record<string, number> = { DRAFT: 1, DATA_IMPORTED: 2, RECONCILING: 2, EXCEPTIONS_PENDING: 2, READY_FOR_CALCULATION: 3, CALCULATED: 3, CALCULATION_VALIDATED: mode === "SIMULATION" ? 4 : 4, PENDING_APPROVAL: 4, REJECTED: 4, APPROVED: 5, OBLIGATIONS_CREATED: 5, PAYMENT_IN_PROGRESS: 5, PARTIALLY_SETTLED: 5, PAYMENT_FAILED: 5, SETTLED: 6, RECONCILED: 6 };
  const current = stage[status];
  const steps = ["Policy", "Import", "Exceptions", "Calculation", "Approval", "Settlement"].map((label, i): PeriodStep => ({ label, state: current === undefined ? "unavailable" : i < current ? "done" : i === current ? "current" : "pending", detail: i === 0 ? "Pinned approved policy" : "" }));
  if (current === undefined) return steps;
  if (openExceptions > 0 && current <= 3) steps[2] = { label: "Exceptions", state: "blocked", detail: `${openExceptions} open` };
  if (status === "CALCULATED") steps[3].detail = "Validation needed";
  if (status === "REJECTED") steps[4] = { label: "Approval", state: "blocked", detail: "Rejected; start a new run" };
  if (mode === "SIMULATION") {
    steps[4] = { label: "Approval", state: "unavailable", detail: "Simulation stops at calculation" };
    steps[5] = { label: "Settlement", state: "unavailable", detail: "Simulation cannot pay" };
  } else if (current < 6 && !liveEnabled) steps[5] = { label: "Settlement", state: "blocked", detail: "Live payments are off" };
  else if (status === "PAYMENT_FAILED") steps[5] = { label: "Settlement", state: "blocked", detail: "Payment review needed" };
  else if (status === "PARTIALLY_SETTLED") steps[5].detail = "Some payments remain";
  else if (status === "SETTLED") steps[5].detail = "Receipts verified; reconciliation pending";
  return steps;
}

/** Bounded selected-run facts; a partial read is unavailable, never an estimated count or total. */
export async function periodView(client: SupabaseClient, actor: { companyId: string; userId: string; roles: readonly Role[] }, runId: string) {
  const { companyId, roles } = actor;
  const run = await client.from("payroll_runs").select("id, status").eq("company_id", companyId).eq("id", runId).maybeSingle();
  if (run.error) throw new Error("period run read failed");
  if (!run.data) return null;
  const cap = 2000;
  const [timesheets, leave, exceptions, calc, obligations, approval, batches, activity] = await Promise.all([
    client.from("timesheets").select("id, worker_id").eq("company_id", companyId).eq("run_id", runId).limit(cap + 1),
    client.from("leave_records").select("id, worker_id").eq("company_id", companyId).eq("run_id", runId).limit(cap + 1),
    client.from("exceptions").select("status, evidence").eq("company_id", companyId).eq("run_id", runId).in("category", RECON_CATEGORIES).limit(cap + 1),
    client.from("calculations").select("id").eq("company_id", companyId).eq("run_id", runId).maybeSingle(),
    client.from("obligations").select("id, worker_id, status").eq("company_id", companyId).eq("run_id", runId).limit(cap + 1),
    client.from("payroll_approvals").select("approver_id").eq("company_id", companyId).eq("run_id", runId).maybeSingle(),
    client.from("payment_batches").select("id, status").eq("company_id", companyId).eq("run_id", runId).limit(cap + 1),
    auditView(client, companyId, { runId, limit: 8 }),
  ]);
  if (calc.error || approval.error) throw new Error("period read failed");
  const records = [...must(timesheets, "period timesheets"), ...must(leave, "period leave")];
  const ex = must(exceptions, "period exceptions");
  const obs = must(obligations, "period obligations");
  const plans = must(batches, "period batches");
  const complete = timesheets.data!.length <= cap && leave.data!.length <= cap && ex.length <= cap && obs.length <= cap;
  const lines = calc.data ? must(await client.from("calculation_lines").select("worker_id, net").eq("company_id", companyId).eq("calculation_id", calc.data.id).limit(cap + 1), "period lines") : null;
  const flagged = new Set(ex.flatMap((e) => (e.evidence?.recordIds ?? []) as string[]));
  const autoMatched = records.filter((r) => !flagged.has(r.id)).length;
  const countResult = await client.from("exceptions").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("run_id", runId).in("status", ["OPEN", "IN_REVIEW", "ESCALATED"]);
  if (countResult.error || countResult.count === null) throw new Error("period exception count failed");
  const workers = new Set([...records.map((r) => r.worker_id), ...(lines ?? []).map((l) => l.worker_id), ...obs.map((o) => o.worker_id)]);
  return {
    workers: complete && (!lines || lines.length <= cap) && workers.size ? workers.size : null,
    autoMatched: complete && records.length && !["DRAFT", "DATA_IMPORTED", "RECONCILING"].includes(run.data.status) ? { count: autoMatched, total: records.length } : null,
    openExceptions: countResult.count,
    netTotal: lines && lines.length <= cap && (isPayrollRole(roles) || isPaymentRole(roles)) ? usd(lines.reduce((sum, l) => sum + BigInt(l.net), 0n)) : null,
    settled: complete ? obs.filter((o) => o.status === "SETTLED").length : null,
    obligations: complete ? obs.length : null,
    canSign: isPaymentRole(roles) && !!approval.data && approval.data.approver_id !== actor.userId && plans.some((p) => p.status === "PROPOSED"),
    activity,
  };
}

/** One selected worker, immutable compensation versions, past runs, exceptions and payments. No names or raw evidence. */
export async function workerHistoryView(client: SupabaseClient, companyId: string, workerId: string, roles: readonly Role[]) {
  const worker = (await client.from("workers").select("id, pseudonym").eq("company_id", companyId).eq("id", workerId).maybeSingle()).data;
  if (!worker) return null;
  const financial = isPayrollRole(roles) || isPaymentRole(roles);
  const [compensations, exceptions, payments, calculationRead] = await Promise.all([
    financial ? client.from("compensations").select("id, version, reason, created_at, payload_enc").eq("company_id", companyId).eq("worker_id", workerId).order("version", { ascending: false }).limit(21) : null,
    client.from("exceptions").select("id, run_id, category, status, created_at").eq("company_id", companyId).eq("worker_id", workerId).order("created_at", { ascending: false }).limit(21),
    client.from("obligations").select(financial ? "id, run_id, amount, status, tx_hash, updated_at" : "id, run_id, status, updated_at").eq("company_id", companyId).eq("worker_id", workerId).order("created_at", { ascending: false }).limit(21),
    client.from("calculations").select(financial ? "id, run_id, calculation_lines!inner(worker_id, net)" : "id, run_id, calculation_lines!inner(worker_id)").eq("company_id", companyId).eq("calculation_lines.worker_id", workerId).order("created_at", { ascending: false }).limit(21),
  ]);
  const ex = must(exceptions, "worker exceptions");
  const pay = must(payments, "worker payments") as unknown as { id: string; run_id: string; amount?: string; status: string; tx_hash?: string; updated_at: string }[];
  const calculations = must(calculationRead, "worker calculations") as unknown as { id: string; run_id: string; calculation_lines: { worker_id: string; net?: string }[] }[];
  const runIds = [...new Set([...ex.map((e) => e.run_id), ...pay.map((p) => p.run_id), ...calculations.map((c) => c.run_id)])];
  const runs = runIds.length ? must(await client.from("payroll_runs").select("id, mode, status, period_start, period_end").eq("company_id", companyId).in("id", runIds).order("period_start", { ascending: false }).limit(61), "worker runs") : [];
  const changes = compensations ? await Promise.all(must(compensations, "worker compensation").slice(0, 20).map(async (c) => {
    const values = await openJson<{ baseAmount: string; hourlyRate: string }>(companyId, "compensations", "payload_enc", c.id, c.payload_enc);
    return { version: c.version, reason: c.reason, at: c.created_at, base: usd(BigInt(values.baseAmount)), hourly: usd(BigInt(values.hourlyRate)) };
  })) : [];
  return { code: worker.pseudonym as string, changes, exceptions: ex.slice(0, 20), payments: pay.slice(0, 20).map((p) => ({ id: p.id, runId: p.run_id, status: p.status, at: p.updated_at, amount: p.amount === undefined ? null : usd(BigInt(p.amount)), txUrl: p.tx_hash ? EXPLORER_TX(p.tx_hash) : null })), runs: runs.slice(0, 20).map((r) => ({ ...r, net: (() => { const line = calculations.find((c) => c.run_id === r.id)?.calculation_lines[0]; return line?.net === undefined ? null : usd(BigInt(line.net)); })() })), truncated: ex.length > 20 || pay.length > 20 || calculations.length > 20 || runs.length > 20 || (compensations?.data?.length ?? 0) > 20 };
}

/** Null when the run is not in the caller's company (the page answers 404, S13). */
export async function runView(client: SupabaseClient, companyId: string, runId: string) {
  const { data: run, error: runError } = await client.from("payroll_runs").select("*").eq("id", runId).eq("company_id", companyId).maybeSingle();
  if (runError) throw new Error("run read failed");
  if (!run) return null;
  const { data: calc, error: calcError } = await client.from("calculations").select("id, calculation_hash").eq("run_id", runId).eq("company_id", companyId).maybeSingle();
  if (calcError) throw new Error("calculation read failed");
  const lines = calc ? await loadLines(client, companyId, calc.id) : [];
  const workers = must(await client.from("workers").select("id, pseudonym").eq("company_id", companyId), "workers");
  const obligations = must(await client.from("obligations").select("id, worker_id, amount, recipient, status, tx_hash, exception_code, exception_reasons").eq("run_id", runId).eq("company_id", companyId), "obligations");
  const name = (id: string) => workers.find((w) => w.id === id)?.pseudonym ?? "unknown";
  // Variance exists only when "actually paid" amounts were imported; the findings are decrypted here, on the server.
  const hasActual = (must(await client.from("actual_payments").select("id").eq("run_id", runId).eq("company_id", companyId).limit(1), "actual payments")).length > 0;
  const findings = calc ? must(await client.from("variance_findings").select("id, worker_id, kind, detail_enc").eq("calculation_id", calc.id).eq("company_id", companyId), "variance") : [];
  const variance = await Promise.all(
    findings.map(async (f) => {
      const d = await openJson<{ expected: string; actual: string; difference: string }>(companyId, "variance_findings", "detail_enc", f.id, f.detail_enc);
      return { id: f.id, worker: name(f.worker_id), kind: f.kind as string, expected: usd(BigInt(d.expected)), actual: usd(BigInt(d.actual)), difference: usd(BigInt(d.difference)) };
    }),
  );
  return {
    run,
    variance: calc ? { available: hasActual, findings: variance.sort((x, y) => x.worker.localeCompare(y.worker)) } : null,
    calculationHash: calc?.calculation_hash ?? null,
    netTotal: usd(lines.reduce((sum, l) => sum + BigInt(l.net), 0n)),
    lines: lines.map((l) => ({
      id: l.id,
      worker: name(l.workerId),
      gross: usd(l.gross),
      deductions: usd(l.deductions),
      net: usd(l.net),
      trace: l.trace.map((t) => ({ component: t.component, source: t.source, inputs: t.inputs, rule: t.rule, ruleVersion: t.ruleVersion, step: t.step, amount: usd(t.amount) })),
    })),
    obligations: obligations.map((o) => ({
      id: o.id,
      worker: name(o.worker_id),
      amount: usd(o.amount),
      recipient: o.recipient,
      status: o.status,
      txHash: o.tx_hash,
      txUrl: o.tx_hash ? EXPLORER_TX(o.tx_hash) : null,
      exception: o.exception_code ? { code: o.exception_code, reasons: o.exception_reasons ?? [] } : null,
    })),
  };
}
