import { z } from "zod";

export interface ReadinessRequirement {
  id: string;
  label: string;
  required: boolean;
  freshAfter?: string;
  waiver?: { reason: string; evidenceRef: string };
}
export interface ReadinessEvidence {
  requirementId: string;
  ref: string;
  receivedAt: string;
  observedAt: string;
  valid: boolean;
}
export interface ReadinessCutoff { at: string; timeZone: string }
export interface ReadinessInput {
  requirements: ReadinessRequirement[] | null;
  evidence: ReadinessEvidence[];
  cutoff: ReadinessCutoff | null;
  now: string;
  validationProblems: string[];
}
export type ReadinessStatus = "MISSING" | "STALE" | "LATE" | "INVALID" | "WAIVED" | "RECEIVED";
export interface ReadinessItem { id: string; label: string; status: ReadinessStatus; ref: string | null; reason: string | null }
export interface ReadinessResult {
  ready: boolean;
  expected: number;
  received: number;
  cutoff: ReadinessCutoff | null;
  blockers: string[];
  items: ReadinessItem[];
}
const instant = (value: string) => z.iso.datetime({ offset: true }).safeParse(value).success ? Date.parse(value) : NaN;

/** A completeness projection only; waivers never grant validation or financial authority. */
export function deriveReadiness(input: ReadinessInput): ReadinessResult {
  const blockers = [...input.validationProblems];
  const now = instant(input.now), cutoff = input.cutoff ? instant(input.cutoff.at) : NaN;
  let timezoneValid = false;
  if (input.cutoff) {
    try { new Intl.DateTimeFormat("en", { timeZone: input.cutoff.timeZone }); timezoneValid = true; } catch { /* invalid configuration blocks */ }
  }
  if (!Number.isFinite(now)) blockers.push("Current time is invalid");
  if (!Number.isFinite(cutoff) || !timezoneValid) blockers.push("Cutoff and timezone require valid configuration");
  if (input.requirements === null) blockers.push("Expected inputs require configuration");
  const requirements = input.requirements ?? [];
  if (new Set(requirements.map(r => r.id)).size !== requirements.length) blockers.push("Duplicate expected input identifiers");
  const items = requirements.map((r): ReadinessItem => {
    const candidates = input.evidence.filter(e => e.requirementId === r.id);
    // Latest received revision governs; invalid timestamps cannot disappear behind a valid earlier revision.
    const evidence = candidates.find(e => !Number.isFinite(instant(e.receivedAt))) ?? candidates.sort((a, b) => instant(b.receivedAt) - instant(a.receivedAt) || a.ref.localeCompare(b.ref))[0];
    let status: ReadinessStatus = "MISSING", ref: string | null = evidence?.ref ?? null, reason: string | null = "Input not received";
    if (!evidence && r.waiver?.reason.trim() && r.waiver.evidenceRef.trim()) {
      status = "WAIVED"; ref = r.waiver.evidenceRef; reason = r.waiver.reason;
    } else if (evidence) {
      const received = instant(evidence.receivedAt), observed = instant(evidence.observedAt), freshAfter = r.freshAfter !== undefined ? instant(r.freshAfter) : null;
      if (!evidence.valid || !evidence.ref.trim() || !Number.isFinite(received) || !Number.isFinite(observed) || observed > received || received > now || freshAfter !== null && !Number.isFinite(freshAfter)) {
        status = "INVALID"; reason = "Evidence is invalid or has invalid timestamps";
      } else if (received > cutoff) { status = "LATE"; reason = "Received after the configured cutoff; review again"; }
      else if (freshAfter !== null && observed < freshAfter) { status = "STALE"; reason = "Evidence precedes the configured freshness boundary"; }
      else { status = "RECEIVED"; reason = null; }
    }
    if (r.required && status !== "RECEIVED" || status === "INVALID" || status === "LATE" || status === "STALE") blockers.push(`${r.label}: ${reason ?? status}`);
    return { id: r.id, label: r.label, status, ref, reason };
  });
  return { ready: blockers.length === 0, expected: requirements.filter(r => r.required).length, received: items.filter((v, i) => requirements[i].required && v.status === "RECEIVED").length, cutoff: input.cutoff, blockers, items };
}
