import "server-only";
import type { RunState } from "@/core/domain/machines";
import type { RunDeps } from "@/core/workflow";
import { writeAudit } from "./audit";
import { db, must } from "./client";
import { dbStore } from "./store";

export const runStore = dbStore<RunState>("payroll_runs");

export const runDeps: RunDeps = {
  async liveEnabled(companyId) {
    return must(await db().from("companies").select("live_payments_enabled").eq("id", companyId).single(), "company read").live_payments_enabled;
  },
  async activeConfigVersion(companyId) {
    const row = (await db().from("payroll_configurations").select("version").eq("company_id", companyId).eq("status", "ACTIVE").maybeSingle()).data;
    return row?.version ?? null;
  },
  async insertRun(r) {
    const row = must(
      await db()
        .from("payroll_runs")
        .insert({ company_id: r.companyId, mode: r.mode, period_start: r.periodStart, period_end: r.periodEnd, config_version: r.configVersion, created_by: r.createdBy })
        .select("id")
        .single(),
      "run insert",
    );
    return { id: row.id };
  },
  audit: writeAudit,
};
