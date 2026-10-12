"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

const DURATION = 300; // DESIGN.md §10 reveal timing, calm ease-out
const EASE = "cubic-bezier(0.2, 0, 0, 1)";

// FAQ item on the landing page: native <details>/<summary> (keyboard, find-in-page, no-JS fallback) with a smooth
// height + opacity transition. The summary click is intercepted so closing can animate before `open` is removed.
// Under prefers-reduced-motion it toggles instantly.
export function FaqItem({ question, answer }: { question: string; answer: string }) {
  const details = useRef<HTMLDetailsElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);
  const [open, setOpen] = useState(false);

  function toggle(e: React.MouseEvent) {
    const d = details.current;
    const b = body.current;
    if (!d || !b) return;
    e.preventDefault();
    const opening = !open;
    setOpen(opening);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = anim.current ? b.getBoundingClientRect().height : opening ? 0 : b.scrollHeight;
    anim.current?.cancel();
    if (reduced || typeof b.animate !== "function") {
      d.open = opening;
      anim.current = null;
      return;
    }
    if (opening) d.open = true;
    const to = opening ? b.scrollHeight : 0;
    const a = b.animate(
      [
        { height: `${from}px`, opacity: opening ? 0 : 1 },
        { height: `${to}px`, opacity: opening ? 1 : 0 },
      ],
      { duration: DURATION, easing: EASE },
    );
    anim.current = a;
    a.onfinish = () => {
      anim.current = null;
      if (!opening) d.open = false;
    };
  }

  return (
    <details ref={details} className="rounded-[1.25rem] bg-white px-6 py-5 transition-shadow duration-200 hover:shadow-nav" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary onClick={toggle} className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-[1.25rem] text-lg font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <h3>{question}</h3>
        <span aria-hidden data-open={open} className={cn("flex size-10 shrink-0 items-center justify-center rounded-full bg-background text-2xl leading-none transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none", open && "rotate-45")}>
          +
        </span>
      </summary>
      <div ref={body} className="overflow-hidden">
        <p className="pt-3 leading-relaxed text-muted-foreground">{answer}</p>
      </div>
    </details>
  );
}
