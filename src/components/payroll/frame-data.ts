import type { SupabaseClient } from "@supabase/supabase-js";
import { periodLabel } from "@/components/shell/nav-config";
import type { Role } from "@/core/tenancy";
import { periodView } from "@/server/db/views";

/** What the payroll frame (title, period, summary line) may say about the run. Null means unknown, never zero. */
export interface FrameFacts {
  workers: number | null;
  autoMatched: { count: number; total: number } | null;
  openExceptions: number | null;
}
export interface FrameRun {
  id: string;
  label: string;
  status: string;
}
export interface FrameData {
  facts: FrameFacts;
  runs: FrameRun[];
}

const unknown: FrameFacts = { workers: null, autoMatched: null, openExceptions: null };

/**
 * Bounded, read-only facts for the summary line plus the newest runs for the period menu. A failed read hides the figures
 * (the page still renders its own evidence); it never turns into zeros.
 */
export async function loadFrameData(client: SupabaseClient, actor: { companyId: string; userId: string; roles: readonly Role[] }, runId: string, known?: FrameFacts): Promise<FrameData> {
  let facts = known ?? unknown;
  try {
    const view = known ? null : await periodView(client, actor, runId);
    if (view) facts = { workers: view.workers, autoMatched: view.autoMatched, openExceptions: view.openExceptions };
  } catch {
    // facts stay unknown
  }
  let runs: FrameRun[] = [];
  try {
    const read = await client.from("payroll_runs").select("id, status, period_start, period_end").eq("company_id", actor.companyId).order("created_at", { ascending: false }).limit(12);
    if (!read.error && read.data) runs = read.data.map((r) => ({ id: r.id as string, status: r.status as string, label: periodLabel(`${r.period_start} to ${r.period_end}`) }));
  } catch {
    // the menu then offers only the current run
  }
  return { facts, runs };
}
