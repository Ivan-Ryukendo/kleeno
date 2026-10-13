"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

// Black surface with orange gradients (DESIGN.md §13: "Edgy" blobs plus a "Blurred" diagonal wash) and a glow that follows the cursor.
// Public pages and auth/empty states only; never on working tables or money/approval screens.
// The gradients are plain CSS, so they render without JavaScript. The cursor glow is added only for a fine pointer and
// when the visitor has not asked for reduced motion; otherwise the blobs stay still.
const blobs =
  "radial-gradient(46% 62% at 12% 18%, color-mix(in oklab, var(--signal) 70%, transparent), transparent 70%)," +
  "radial-gradient(40% 55% at 86% 8%, color-mix(in oklab, var(--orbit) 55%, transparent), transparent 70%)," +
  "radial-gradient(52% 60% at 70% 105%, color-mix(in oklab, var(--signal) 45%, transparent), transparent 72%)";
const wash = "linear-gradient(135deg, color-mix(in oklab, var(--orbit) 26%, transparent) 0%, transparent 46%, color-mix(in oklab, var(--signal) 22%, transparent) 100%)";
const cursor = "radial-gradient(22rem circle at var(--mx, 50%) var(--my, 30%), color-mix(in oklab, var(--orbit) 55%, transparent), transparent 65%)";

export function GlowSurface({ className, strength = "full", children }: { className?: string; strength?: "full" | "soft"; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  function move(e: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${clientX - r.left}px`);
      el.style.setProperty("--my", `${clientY - r.top}px`);
      el.dataset.live = "true";
    });
  }

  function leave() {
    cancelAnimationFrame(frame.current);
    if (ref.current) delete ref.current.dataset.live;
  }

  return (
    <div ref={ref} onPointerMove={move} onPointerLeave={leave} className={cn("group/glow relative isolate overflow-hidden bg-ink", className)}>
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 -z-10 blur-2xl", strength === "soft" ? "opacity-60" : "opacity-100")} style={{ backgroundImage: blobs }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ backgroundImage: wash }} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 group-data-[live=true]/glow:opacity-100 motion-reduce:hidden"
        style={{ backgroundImage: cursor }}
      />
      {children}
    </div>
  );
}
