"use client";

import { Check, Lock, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StepState = "done" | "current" | "blocked" | "pending" | "unavailable";
export interface StepCard {
  title: string;
  state: StepState;
  summary: string;
  label: string;
  detail: ReactNode;
}

const badge: Record<StepState, string> = {
  done: "border-transparent bg-success-soft text-success",
  current: "border-primary text-foreground",
  blocked: "border-transparent bg-signal/10 text-signal",
  pending: "border-border text-muted-foreground",
  unavailable: "border-border text-muted-foreground",
};
const edge: Record<StepState, string> = { done: "border-l-success", current: "border-l-primary", blocked: "border-l-signal", pending: "border-l-border", unavailable: "border-l-border" };

/** The step cards and the selected step's detail (mockups/payroll-workflow.html). Selecting only shows evidence; nothing here runs a transition. */
export function WorkflowStepper({ steps }: { steps: StepCard[] }) {
  const first = steps.findIndex((s) => s.state === "blocked");
  const initial = steps.findIndex((s) => s.state === "current");
  const [picked, setPicked] = useState(initial >= 0 ? initial : Math.max(first, 0));
  const step = steps[picked];
  if (!step) return null;
  return (
    <div>
      <ol aria-label="Inspect a workflow step" className="flex gap-2 overflow-x-auto p-4 [scrollbar-width:thin]">
        {steps.map((s, i) => (
          <li key={s.title} className="min-w-36 flex-1">
            <button
              type="button"
              aria-pressed={i === picked}
              aria-label={`Step ${i + 1}, ${s.title}, ${s.label}`}
              onClick={() => setPicked(i)}
              className={cn("flex min-h-28 w-full flex-col items-start gap-1 rounded-card border border-l-4 bg-card p-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", edge[s.state], i === picked && "ring-2 ring-ring/40")}
            >
              <span className="text-xs text-muted-foreground">Step {i + 1}</span>
              <span className="text-sm font-medium">{s.title}</span>
              <span className={cn("text-xs break-words", s.state === "blocked" ? "text-signal" : "text-muted-foreground")}>{s.summary}</span>
              <span className={cn("mt-auto inline-flex items-center gap-1 rounded-chip border px-1.5 text-xs leading-5 font-medium", badge[s.state])}>
                {s.state === "done" && <Check aria-hidden="true" className="size-3" />}
                {s.state === "blocked" && <TriangleAlert aria-hidden="true" className="size-3" />}
                {s.state === "unavailable" && <Lock aria-hidden="true" className="size-3" />}
                {s.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="border-t px-4 py-4" aria-live="polite">
        <h3 className="text-sm font-medium">
          {picked + 1}. {step.title} <span className={cn("ml-2 inline-block rounded-chip border px-1.5 text-xs leading-5 font-medium", badge[step.state])}>{step.label}</span>
        </h3>
        <p className="mt-1 text-sm text-muted-foreground break-words">{step.summary}</p>
        <div className="mt-3 min-w-0 text-sm">{step.detail}</div>
      </div>
    </div>
  );
}
