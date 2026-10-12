"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type LandingStep = { title: string; body: string; detail: string };

// Horizontal accordion for "How it works" (landing page only). Vertical slices widen on hover, focus or tap.
// Each slice header is a real button with aria-expanded, so keyboard and touch users get the same control as hover.
// Width changes use flex-grow with a CSS transition, which reduced motion turns into an instant change.
export function LandingSteps({ steps }: { steps: LandingStep[] }) {
  const [open, setOpen] = useState(0);

  return (
    <ol className="flex flex-col gap-3 lg:h-[34rem] lg:flex-row">
      {steps.map((s, i) => {
        const active = open === i;
        const panel = `step-panel-${i}`;
        return (
          <li
            key={s.title}
            onMouseEnter={() => setOpen(i)}
            className={cn(
              "group relative flex min-w-0 flex-col overflow-hidden rounded-[2.5rem] transition-[flex-grow,background-color,color] duration-700 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
              active ? "bg-ink text-white lg:flex-[4_1_0%]" : "bg-card text-foreground lg:flex-[1_1_0%]",
            )}
          >
            <h3 className="m-0">
              <button
                type="button"
                aria-expanded={active}
                aria-controls={panel}
                onClick={() => setOpen(i)}
                onFocus={() => setOpen(i)}
                className={cn(
                  "flex min-h-16 w-full cursor-pointer items-center justify-between gap-4 rounded-[2.5rem] px-7 py-5 text-left text-2xl font-medium tracking-[-0.02em] outline-none focus-visible:ring-3 sm:text-3xl",
                  active ? "focus-visible:ring-white/60" : "focus-visible:ring-ring/40",
                )}
              >
                <span className={cn(!active && "lg:[writing-mode:vertical-rl] lg:rotate-180 lg:py-4")}>{s.title}</span>
                <span aria-hidden className={cn("flex size-11 shrink-0 items-center justify-center rounded-full text-xl transition-transform duration-500 motion-reduce:transition-none", active ? "rotate-45 bg-white text-foreground" : "bg-white text-foreground", !active && "lg:hidden")}>
                  +
                </span>
              </button>
            </h3>
            <div id={panel} hidden={!active} className="flex flex-1 flex-col justify-end px-7 pb-8 lg:min-w-[26rem]">
              <p className="max-w-xl text-xl leading-snug text-white sm:text-2xl">{s.body}</p>
              <p className="mt-4 max-w-xl leading-relaxed text-white/75">{s.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
