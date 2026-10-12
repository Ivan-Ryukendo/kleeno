"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** "Add a worker" disclosure. The header button links to #add-worker; the panel opens when that fragment is the target. */
export function AddWorkerPanel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const sync = () => { if (window.location.hash === "#add-worker" && ref.current) ref.current.open = true; };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return (
    <details ref={ref} id="add-worker" className="group mt-6 scroll-mt-20 rounded-card border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary">
        <span className="text-lg font-medium">Add a worker</span>
        <span className="text-xs font-normal text-muted-foreground group-open:hidden">Open the form</span>
      </summary>
      <div className="border-t border-border px-4 pb-4 sm:px-6">{children}</div>
    </details>
  );
}
