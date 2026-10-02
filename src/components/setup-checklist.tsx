import Link from "next/link";
import type { SetupItem } from "@/core/setup";

// Dashboard card for new companies (docs/pages.md #6): computed from data, so a tick always means it really exists.
export function SetupChecklist({ items, done, total }: { items: SetupItem[]; done: number; total: number }) {
  return (
    <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card" aria-labelledby="setup-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="setup-title" className="text-2xl">
            Set up your company
          </h2>
          <p className="mt-1 text-muted-foreground">
            {done} of {total} done
          </p>
        </div>
        <div className="h-2 w-48 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} aria-label="Setup progress">
          <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      </div>
      <ul className="mt-6 divide-y divide-border">
        {items.map((i) => (
          <li key={i.id}>
            <Link href={i.href} className="flex items-start gap-4 py-4 transition-colors hover:bg-muted/50">
              <span aria-hidden className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs ${i.done ? "border-primary bg-primary text-primary-foreground" : "border-primary/40 bg-white"}`}>
                {i.done ? "✓" : ""}
              </span>
              <span>
                <span className={`block font-medium ${i.done ? "text-muted-foreground line-through" : ""}`}>{i.label}</span>
                <span className="block text-sm text-muted-foreground">{i.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
